import type { AttemptRecord, FeedbackRecord, LearningEvent } from './types.js';
import { effectiveFeedback, type LearningStore } from './store.js';

export type ExportType = 'eval' | 'embedding';

export async function exportDataset(store: LearningStore, type: ExportType): Promise<unknown[]> {
  const events = await store.events();
  const feedback = effectiveFeedback(events);
  const attempts = uniqueAttempts(events);
  return type === 'eval'
    ? attempts.map((attempt) => evalRecord(attempt, feedback.get(attempt.attempt_id)))
    : attempts
        .filter((attempt) => feedback.get(attempt.attempt_id)?.rating === 3 && attempt.evidence_used.length > 0)
        .map((attempt) => embeddingRecord(attempt));
}

function evalRecord(attempt: AttemptRecord, feedback?: FeedbackRecord): unknown {
  return {
    interaction_id: attempt.interaction_id,
    attempt_id: attempt.attempt_id,
    query: attempt.user_query,
    relevant_files: [...new Set(attempt.evidence_used.flatMap((hit) => (hit.path ? [hit.path] : [])))],
    relevant_symbols: [...new Set(attempt.evidence_used.flatMap((hit) => (hit.symbol ? [hit.symbol] : [])))],
    rating: feedback?.rating,
    label: feedback?.label,
    repositories: attempt.repositories,
  };
}

function embeddingRecord(attempt: AttemptRecord): unknown {
  const positive = new Set(attempt.evidence_used.map(resultKey));
  return {
    interaction_id: attempt.interaction_id,
    query: attempt.user_query,
    positive_chunks: attempt.evidence_used,
    hard_negative_chunks: attempt.retrieved_results.filter((hit) => !positive.has(resultKey(hit))),
  };
}

function resultKey(hit: AttemptRecord['retrieved_results'][number]): string {
  return `${hit.repo ?? ''}:${hit.path ?? ''}:${hit.symbol ?? ''}:${hit.start_line ?? ''}`;
}

function uniqueAttempts(events: LearningEvent[]): AttemptRecord[] {
  const attempts = new Map<string, AttemptRecord>();
  for (const event of events) {
    if (event.type === 'attempt_recorded') attempts.set(event.attempt.attempt_id, event.attempt);
  }
  return [...attempts.values()];
}
