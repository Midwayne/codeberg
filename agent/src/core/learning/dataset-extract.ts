import { basename } from 'node:path';

import { redactSecrets } from './redact.js';
import { extractRetrieval, isRetrievalTask } from './retrieval-extract.js';
import { sourceRevision } from './revision.js';
import { stableId } from './store.js';
import type { DatasetExample, DatasetKind, Provenance } from './datasets.js';
import type { AttemptRecord, FeedbackRecord, ToolInvocation } from './types.js';

export const EXTRACTION_VERSION = 2;

export type RecordedAttempt = {
  attempt_id: string;
  user_query: string;
  answer: string;
  steps: NonNullable<AttemptRecord['trajectory']>;
  tools: ToolInvocation[];
  feedback?: FeedbackRecord;
};

export type EmitExample = (
  kind: DatasetKind,
  payload: Record<string, unknown>,
  provenance?: Provenance,
) => void;

export interface ExtractionContext {
  attempts: AttemptRecord[];
  grades: Map<string, FeedbackRecord>;
  final?: AttemptRecord;
  trajectory: RecordedAttempt[];
  verifier?: ToolInvocation;
  emit: EmitExample;
}

/** One interaction can independently yield several types of candidate. */
export function extractExamples(
  interactionId: string,
  attempts: AttemptRecord[],
  feedback: FeedbackRecord[],
  grades: Map<string, FeedbackRecord>,
): DatasetExample[] {
  if (!attempts.length) return [];

  if (
    !feedback.length &&
    !attempts.some((attempt) => attempt.tools_invoked.length && attempt.answer.trim())
  )
    return [];

  const final =
    grades.get(attempts.at(-1)!.attempt_id)?.label === 'solved' ? attempts.at(-1) : undefined;
  const revision = sourceRevision(attempts, feedback);
  const extractedAt = new Date().toISOString();
  const repositories = uniqueRepositories(attempts);
  const trajectory = recordedTrajectory(attempts, grades);
  const examples: DatasetExample[] = [];
  const emit = createEmitter(examples, {
    interactionId,
    revision,
    extractedAt,
    attempts,
    final,
    repositories,
    feedback,
  });

  const context: ExtractionContext = {
    attempts,
    grades,
    final,
    trajectory,
    verifier: verificationTool(attempts),
    emit,
  };

  if (attempts.some(isRetrievalTask)) extractRetrieval(context, repositories);

  if (final?.answer.trim()) extractSuccessfulTrajectory(context);

  if (context.verifier && final) extractVerifiedTask(context, repositories);

  return examples;
}

function verificationTool(attempts: AttemptRecord[]): ToolInvocation | undefined {
  return attempts
    .flatMap((attempt) => attempt.tools_invoked)
    .find(
      (tool) =>
        /test|compile|build|benchmark|static.analysis/i.test(tool.name) &&
        tool.output !== undefined,
    );
}

function recordedTrajectory(
  attempts: AttemptRecord[],
  grades: Map<string, FeedbackRecord>,
): RecordedAttempt[] {
  return attempts.map((attempt) => ({
    attempt_id: attempt.attempt_id,
    user_query: attempt.user_query,
    answer: attempt.answer,
    steps: attempt.trajectory ?? [],
    tools: attempt.tools_invoked,
    feedback: grades.get(attempt.attempt_id),
  }));
}

interface ExampleMetadata {
  interactionId: string;
  revision: string;
  extractedAt: string;
  attempts: AttemptRecord[];
  final?: AttemptRecord;
  repositories: DatasetExample['repositories'];
  feedback: FeedbackRecord[];
}

function createEmitter(examples: DatasetExample[], metadata: ExampleMetadata): EmitExample {
  const { interactionId, revision, extractedAt, attempts, final, repositories, feedback } =
    metadata;

  return (kind, payload, provenance = 'agent_inferred') => {
    examples.push(
      redactSecrets({
        id: stableId('example', interactionId, revision, String(EXTRACTION_VERSION), kind),
        state: 'candidate',
        source_interaction_id: interactionId,
        extraction_version: EXTRACTION_VERSION,
        source_revision: revision,
        extracted_at: extractedAt,
        query: attempts[0].user_query,
        repositories,
        model: final?.model ?? attempts.at(-1)?.model,
        tool_versions: final?.tool_versions ?? attempts.at(-1)?.tool_versions,
        feedback,
        kind,
        provenance,
        confidence: provenance === 'user_confirmed' ? 'confirmed' : 'unverified',
        payload,
      }),
    );
  };
}

function extractSuccessfulTrajectory(context: ExtractionContext): void {
  const { attempts, final, grades, trajectory, emit } = context;
  if (!final) return;

  emit(
    'sft',
    {
      context: trajectory.map((attempt) => attempt.user_query),
      successful_trajectory: trajectory,
      answer: final.answer,
    },
    'user_confirmed',
  );

  const rejected = attempts.find(
    (attempt) =>
      attempt.attempt_id !== final.attempt_id &&
      attempt.answer !== final.answer &&
      (grades.get(attempt.attempt_id)?.rating ?? 3) < 2,
  );

  if (!rejected) return;

  emit(
    'preferences',
    {
      context: trajectory.map((attempt) => attempt.user_query),
      rejected: rejected.answer,
      chosen: final.answer,
      rejected_trajectory: trajectory.find((attempt) => attempt.attempt_id === rejected.attempt_id),
      chosen_trajectory: trajectory.find((attempt) => attempt.attempt_id === final.attempt_id),
    },
    'user_confirmed',
  );
}

function extractVerifiedTask(
  context: ExtractionContext,
  repositories: DatasetExample['repositories'],
): void {
  const { attempts, final, verifier, trajectory, emit } = context;
  if (!final || !verifier) return;

  emit('rlvr', {
    task: attempts[0].user_query,
    environment: repositories,
    available_tools: unique(attempts.flatMap((attempt) => attempt.available_tools ?? [])),
    observed_tools: unique(
      attempts.flatMap((attempt) => attempt.tools_invoked.map((tool) => tool.name)),
    ),
    verifier: {
      tool: verifier.name,
      version: final.tool_versions?.[verifier.name],
      input: verifier.input,
      observed_output: verifier.output,
      status: 'requires_review',
    },
    successful_trajectory: trajectory,
    reward_components: ['verifier_result', 'tool_calls', 'latency_ms'],
  });
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function uniqueRepositories(attempts: AttemptRecord[]): DatasetExample['repositories'] {
  const byVersion = new Map<string, DatasetExample['repositories'][number]>();
  for (const attempt of attempts) {
    for (const repository of attempt.repositories) {
      const version = {
        name: basename(repository.path),
        ...(repository.branch !== undefined ? { branch: repository.branch } : {}),
        ...(repository.commit !== undefined ? { commit: repository.commit } : {}),
      };

      byVersion.set(JSON.stringify(version), version);
    }
  }

  return [...byVersion.values()];
}
