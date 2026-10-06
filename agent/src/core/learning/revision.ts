import { createHash } from 'node:crypto';

import type { AttemptRecord, FeedbackRecord, LearningEvent } from './types.js';

export function sourceRevision(attempts: AttemptRecord[], feedback: FeedbackRecord[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        attempts: attempts.map((attempt) => attempt.attempt_id),
        feedback: feedback.map((entry) => entry.feedback_id),
      }),
    )
    .digest('hex');
}

/** Revisions are computed from the append-only log, not a potentially stale job projection. */
export function interactionRevisions(events: LearningEvent[]): Map<string, string> {
  const attempts = new Map<string, AttemptRecord[]>();
  const interactionForAttempt = new Map<string, string>();
  const feedback = new Map<string, FeedbackRecord[]>();
  for (const event of events) {
    if (event.type !== 'attempt_recorded') continue;

    const { attempt } = event;
    attempts.set(attempt.interaction_id, [
      ...(attempts.get(attempt.interaction_id) ?? []),
      attempt,
    ]);
    interactionForAttempt.set(attempt.attempt_id, attempt.interaction_id);
  }

  for (const event of events) {
    if (event.type !== 'feedback_recorded') continue;

    const id = interactionForAttempt.get(event.feedback.attempt_id);
    if (id) feedback.set(id, [...(feedback.get(id) ?? []), event.feedback]);
  }

  return new Map(
    [...attempts].map(([id, group]) => [id, sourceRevision(group, feedback.get(id) ?? [])]),
  );
}
