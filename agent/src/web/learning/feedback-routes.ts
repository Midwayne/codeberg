import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LearningService } from '../../core/learning/service.js';
import {
  FEEDBACK_LABELS,
  type FeedbackLabel,
  type FeedbackRating,
} from '../../core/learning/types.js';
import { readJson, sendJson, sendText } from '../http.js';
import { isValidSessionId, type WebSessionStore } from '../sessions/store.js';

export async function postFeedback(
  req: IncomingMessage,
  res: ServerResponse,
  learning: LearningService,
  sessions: WebSessionStore,
): Promise<void> {
  if (!learning.settings.enabled || !learning.settings.history || !learning.settings.historyCapture)
    return sendText(res, 409, 'Learning history is paused. Enable it in Settings.');

  const body = await readJson(req);
  const input = feedbackInput(body);
  if (!input) return sendText(res, 400, 'invalid feedback');

  const { conversationId, messageId, rating, label } = input;
  const session = await sessions.load(conversationId);
  if (!session) return sendText(res, 404, 'conversation not found');

  // Handles the small race where feedback arrives while the just-completed
  // session save is still recording its attempt.
  await learning.recordSession(session.id, session.messages, session.parentId);
  try {
    const result = await learning.feedback({
      conversationId,
      messageId,
      rating: rating as FeedbackRating,
      label: label as FeedbackLabel,
      reason: typeof body?.reason === 'string' ? body.reason : undefined,
    });

    return sendJson(res, 201, result);
  } catch (error) {
    if (String(error).includes('attempt not found')) return sendText(res, 404, String(error));

    throw error;
  }
}

export async function getFeedback(
  res: ServerResponse,
  learning: LearningService,
  url: URL,
): Promise<void> {
  const conversationId = url.searchParams.get('conversation_id') ?? '';
  const messageId = url.searchParams.get('message_id') ?? '';
  if (!isValidSessionId(conversationId) || !messageId) return sendText(res, 400, 'invalid attempt');

  const attempt = await learning.store.attemptForMessage(conversationId, messageId);
  if (!attempt) return sendJson(res, 200, null);

  return sendJson(res, 200, (await learning.store.currentFeedback(attempt.attempt_id)) ?? null);
}

export function feedbackInput(body: Record<string, unknown> | null | undefined) {
  const conversationId = typeof body?.conversation_id === 'string' ? body.conversation_id : '';
  const messageId = typeof body?.message_id === 'string' ? body.message_id : '';
  const rating = body?.rating;
  const label = body?.label;
  if (
    !isValidSessionId(conversationId) ||
    !messageId ||
    !Number.isInteger(rating) ||
    typeof rating !== 'number' ||
    rating < 0 ||
    rating > 3 ||
    label !== FEEDBACK_LABELS[rating]
  ) {
    return undefined;
  }

  return {
    conversationId,
    messageId,
    rating: rating as FeedbackRating,
    label: label as FeedbackLabel,
  };
}
