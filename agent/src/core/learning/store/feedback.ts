import type { FeedbackRecord, LearningEvent } from '../types.js';

export function effectiveFeedback(events: LearningEvent[]): Map<string, FeedbackRecord> {
  const current = new Map<string, FeedbackRecord>();
  for (const event of events) {
    if (event.type !== 'feedback_recorded') continue;

    const existing = current.get(event.feedback.attempt_id);
    if (!existing || event.feedback.timestamp >= existing.timestamp) {
      current.set(event.feedback.attempt_id, event.feedback);
    }
  }

  return current;
}
