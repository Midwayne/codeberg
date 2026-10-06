import type { UIMessage } from 'ai';
import { randomUUID } from 'node:crypto';
import { redactSecrets } from '../redact.js';
import {
  FEEDBACK_LABELS,
  type AttemptRecord,
  type FeedbackLabel,
  type FeedbackRating,
  type FeedbackRecord,
} from '../types.js';
import { append, readEvents } from './events.js';
import { effectiveFeedback } from './feedback.js';
import { readRepositories } from './interactions.js';
import { SessionCapture } from './session.js';
import type { LearningStoreState } from './state.js';

export async function recordSession(
  state: LearningStoreState,
  conversationId: string,
  messages: UIMessage[],
  parentConversationId?: string,
): Promise<AttemptRecord[]> {
  const events = await readEvents(state);
  const existing = new Set(
    events
      .filter((event) => event.type === 'attempt_recorded')
      .map((event) => event.attempt.attempt_id),
  );

  const feedback = effectiveFeedback(events);
  const repositories = await readRepositories(state);
  const recorded: AttemptRecord[] = [];
  const capture = new SessionCapture(conversationId, feedback, repositories);

  for (const message of messages) {
    const attempt = capture.next(message, existing);
    if (!attempt) continue;

    await append(state, {
      event_id: randomUUID(),
      type: 'attempt_recorded',
      timestamp: attempt.timestamp,
      attempt,
    });
    existing.add(attempt.attempt_id);
    recorded.push(attempt);
  }

  void parentConversationId; // Branch lineage remains in the session store; history is immutable here.

  return recorded;
}

export async function recordFeedback(
  state: LearningStoreState,
  input: {
    attemptId: string;
    rating: FeedbackRating;
    label: FeedbackLabel;
    reason?: string;
    supersedesFeedbackId?: string;
  },
): Promise<FeedbackRecord> {
  if (FEEDBACK_LABELS[input.rating] !== input.label) {
    throw new Error('feedback rating and label do not match');
  }

  const events = await readEvents(state);
  const attempt = events.some(
    (event) => event.type === 'attempt_recorded' && event.attempt.attempt_id === input.attemptId,
  );
  if (!attempt) throw new Error(`unknown attempt: ${input.attemptId}`);

  const current = effectiveFeedback(events).get(input.attemptId);
  const feedback: FeedbackRecord = redactSecrets({
    feedback_id: randomUUID(),
    attempt_id: input.attemptId,
    timestamp: new Date().toISOString(),
    rating: input.rating,
    label: input.label,
    ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
    ...((input.supersedesFeedbackId ?? current?.feedback_id)
      ? { supersedes_feedback_id: input.supersedesFeedbackId ?? current?.feedback_id }
      : {}),
  });

  await append(state, {
    event_id: randomUUID(),
    type: 'feedback_recorded',
    timestamp: feedback.timestamp,
    feedback,
  });

  return feedback;
}
