import type { ExtractionContext } from '../dataset-extract.js';
import type { DatasetExample } from '../datasets.js';

export function extractSuccessfulTrajectory(context: ExtractionContext): void {
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

export function extractVerifiedTask(
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

export function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
