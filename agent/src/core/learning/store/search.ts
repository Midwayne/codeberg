import type { KnowledgeArtifact, KnowledgeSearchHit, LearningSearchHit } from '../types.js';
import { readEvents } from './events.js';
import { effectiveFeedback } from './feedback.js';
import { currentKnowledgeArtifacts, projectedKnowledgeArtifacts } from './knowledge.js';
import { attemptText, lexicalScore, rankKnowledge } from './ranking.js';
import type { LearningStoreState } from './state.js';

export async function searchLearning(
  state: LearningStoreState,
  query: string,
  limit = 10,
): Promise<LearningSearchHit[]> {
  const events = await readEvents(state);
  const feedback = effectiveFeedback(events);

  return events
    .filter((event) => event.type === 'attempt_recorded')
    .map((event) => ({
      score: lexicalScore(query, attemptText(event.attempt)),
      attempt: event.attempt,
      feedback: feedback.get(event.attempt.attempt_id),
    }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || b.attempt.timestamp.localeCompare(a.attempt.timestamp))
    .slice(0, Math.max(1, limit));
}

export async function searchKnowledge(
  state: LearningStoreState,
  query: string,
  limit = 10,
  options: {
    includeUnverified?: boolean;
    categories?: Partial<Record<KnowledgeArtifact['category'], boolean>>;
  } = {},
): Promise<KnowledgeSearchHit[]> {
  const artifacts = options.includeUnverified
    ? (await projectedKnowledgeArtifacts(state)).filter(
        (artifact) => artifact.status !== 'archived',
      )
    : await currentKnowledgeArtifacts(state);

  const currentIds = options.includeUnverified
    ? new Set((await currentKnowledgeArtifacts(state)).map((artifact) => artifact.id))
    : undefined;
  const navigationKey = query.trim().replace(/^\[\[|\]\]$/g, '');

  return rankKnowledge(
    query,
    artifacts.filter((artifact) => options.categories?.[artifact.category] !== false),
  )
    .map((hit) =>
      navigationKey === hit.artifact.id ||
      navigationKey === `${hit.artifact.category}/${hit.artifact.slug}`
        ? { ...hit, score: Number.MAX_SAFE_INTEGER }
        : hit,
    )
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || b.artifact.updated_at.localeCompare(a.artifact.updated_at))
    .slice(0, Math.max(1, limit))
    .map(({ artifact, score }) => ({
      score,
      artifact:
        currentIds && !currentIds.has(artifact.id) && artifact.status === 'active'
          ? { ...artifact, status: 'needs_verification' as const }
          : artifact,
    }));
}
