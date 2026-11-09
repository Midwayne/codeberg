import { hash } from '../message-fingerprint.js';
import type { AttemptRecord, FeedbackRecord, LearningEvent } from './types.js';

export function sourceRevision(attempts: AttemptRecord[], feedback: FeedbackRecord[]): string {
  return hash(
    JSON.stringify({
      attempts: attempts.map((attempt) => attempt.attempt_id),
      feedback: feedback.map((entry) => entry.feedback_id),
    }),
  );
}

export function attemptInteractions(events: LearningEvent[]): Map<string, string> {
  return new Map(
    events.flatMap((event) =>
      event.type === 'attempt_recorded'
        ? [[event.attempt.attempt_id, event.attempt.interaction_id] as const]
        : [],
    ),
  );
}

/** Revisions are computed from the append-only log, not a potentially stale job projection. */
export function interactionRevisions(events: LearningEvent[]): Map<string, string> {
  const attempts = new Map<string, AttemptRecord[]>();
  const interactionForAttempt = attemptInteractions(events);
  const feedback = new Map<string, FeedbackRecord[]>();
  for (const event of events) {
    if (event.type !== 'attempt_recorded') continue;

    const { attempt } = event;
    attempts.set(attempt.interaction_id, [
      ...(attempts.get(attempt.interaction_id) ?? []),
      attempt,
    ]);
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
