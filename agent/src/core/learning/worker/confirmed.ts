import { join } from 'node:path';

import { writeLearningTrace } from '../../module-log.js';
import { writeAtomic } from '../../fs.js';
import { sourceCommits, sourceHashes, type SourceObservation } from '../memory-source.js';
import { interactionRevisions } from '../revision.js';
import { redactSecrets } from '../redact.js';
import { serializeArtifact } from '../store.js';
import type {
  AttemptRecord,
  FeedbackRecord,
  KnowledgeArtifact,
  KnowledgeCategory,
  KnowledgeJob,
} from '../types.js';
import { artifactLineage } from './artifact.js';
import { confirmedAnswerId, isConfirmedAnswer } from '../confirmed-answer.js';
import type { KnowledgeWorkerState } from './state.js';

const MAX_ANSWER_CHARS = 4_000;
const FALLBACK_ORDER: KnowledgeCategory[] = ['concepts', 'flows', 'services', 'debugging'];

export interface ConfirmedAnswerInput {
  job: KnowledgeJob;
  final: AttemptRecord;
  revision: string;
  currentFeedback?: FeedbackRecord;
  observations: SourceObservation[];
  currentRepositories: Awaited<ReturnType<KnowledgeWorkerState['store']['repositories']>>;
  /** Category the model chose, when it answered but its claims could not be grounded. */
  category?: KnowledgeCategory;
}

/**
 * A Solved rating means the user wants the answer remembered. When no
 * source-quoted claim survives, keep the answer itself as a low-confidence,
 * clearly unverified finding instead of discarding it. Source-change refreshes
 * skip this: an old answer must not be re-confirmed against changed code.
 */
export async function saveConfirmedAnswer(
  state: KnowledgeWorkerState,
  input: ConfirmedAnswerInput,
): Promise<boolean> {
  const { job, final, currentFeedback } = input;
  if (job.source_refresh || currentFeedback?.label !== 'solved' || !final.answer.trim())
    return false;

  const category = confirmedCategory(state, input.category);
  if (!category || (await learnedBefore(state, job.interaction_id))) return false;

  const id = confirmedAnswerId(job.interaction_id);
  const revisions = interactionRevisions(await state.store.events());
  const artifact = confirmedArtifact(input, id, category, revisions);

  await writeAtomic(
    join(state.store.root, 'knowledge', category, `${id}.md`),
    serializeArtifact(artifact),
  );
  writeLearningTrace('confirmed_answer_saved', {
    job_id: job.job_id,
    slug: id,
    files: artifact.source_refs?.length ?? 0,
  });
  state.onKnowledgeChanged?.();

  return true;
}

/** A finding already learned from this answer is refreshed or left unverified, never replaced by it. */
async function learnedBefore(state: KnowledgeWorkerState, interactionId: string): Promise<boolean> {
  return (await state.store.knowledgeArtifacts()).some(
    (artifact) =>
      !isConfirmedAnswer(artifact) &&
      artifact.category !== 'procedures' &&
      artifact.status !== 'archived' &&
      artifact.source_interactions.includes(interactionId),
  );
}

/** A grounded finding supersedes the unverified answer it came from. */
export async function retireConfirmedAnswer(
  state: KnowledgeWorkerState,
  interactionId: string,
): Promise<void> {
  const id = confirmedAnswerId(interactionId);

  for (const artifact of await state.store.knowledgeArtifacts()) {
    if (artifact.id !== id || artifact.status === 'archived') continue;

    await writeAtomic(
      join(state.store.root, 'knowledge', artifact.category, `${artifact.slug}.md`),
      serializeArtifact({ ...artifact, status: 'archived', updated_at: new Date().toISOString() }),
    );
  }
}

function confirmedCategory(state: KnowledgeWorkerState, chosen?: KnowledgeCategory) {
  const enabled = state.settings().categories;
  if (chosen && enabled[chosen]) return chosen;

  return FALLBACK_ORDER.find((category) => enabled[category]);
}

function confirmedArtifact(
  input: ConfirmedAnswerInput,
  id: string,
  category: KnowledgeCategory,
  revisions: Map<string, string>,
): KnowledgeArtifact {
  const { job, final, revision, currentRepositories } = input;
  const now = new Date().toISOString();
  const observations = input.observations.filter((item) => item.hash);

  const cited = new Set(observations.map((item) => item.repo));
  const repositories = currentRepositories
    .filter(
      (repo) =>
        cited.has(repo.path) || final.repositories.some((entry) => entry.path === repo.path),
    )
    .map((repo) => repo.path.split(/[\\/]/).at(-1)!);

  return redactSecrets({
    id,
    slug: id,
    title: final.user_query.trim().replace(/\s+/g, ' ').slice(0, 120) || 'Confirmed answer',
    category,
    created_at: now,
    updated_at: now,
    last_verified_at: now,
    repositories,
    ...artifactLineage(undefined, job.interaction_id, revision, revisions),
    source_commits: sourceCommits(currentRepositories),
    source_refs: observations.map(({ repo, path, symbol }) => ({
      repo,
      path,
      ...(symbol ? { symbol } : {}),
    })),
    source_hashes: sourceHashes(observations),
    claims: [],
    confidence: 'low',
    status: 'active',
    body: confirmedBody(final, observations),
  });
}

function confirmedBody(final: AttemptRecord, observations: SourceObservation[]): string {
  const files = observations.map((item) => `- ${item.repo.split(/[\\/]/).at(-1)}:${item.path}`);

  return [
    '## Confirmed answer (not source-verified)',
    'The user rated this answer Solved. Its claims were not matched to source quotes; check current code before relying on it.',
    `**Question:** ${final.user_query.trim().slice(0, 1_000)}`,
    final.answer.trim().slice(0, MAX_ANSWER_CHARS),
    `## Files consulted\n${files.join('\n') || 'None recorded.'}`,
  ].join('\n\n');
}
