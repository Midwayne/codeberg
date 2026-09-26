import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  FEEDBACK_LABELS,
  type FeedbackLabel,
  type FeedbackRating,
} from '../core/learning/types.js';
import type { LearningService } from '../core/learning/service.js';
import { readJson, sendJson, sendText } from './http.js';
import { isValidSessionId, type WebSessionStore } from './sessions.js';

export const LEARNING_PATH = '/api/learning';

export async function routeLearning(
  req: IncomingMessage,
  res: ServerResponse,
  learning: LearningService,
  sessions: WebSessionStore,
  url: URL,
): Promise<void> {
  if (req.method === 'POST' && url.pathname === `${LEARNING_PATH}/feedback`) {
    const body = await readJson(req);
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
      return sendText(res, 400, 'invalid feedback');
    }
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

  if (req.method === 'GET' && url.pathname === `${LEARNING_PATH}/feedback`) {
    const conversationId = url.searchParams.get('conversation_id') ?? '';
    const messageId = url.searchParams.get('message_id') ?? '';
    if (!isValidSessionId(conversationId) || !messageId) return sendText(res, 400, 'invalid attempt');
    const attempt = await learning.store.attemptForMessage(conversationId, messageId);
    if (!attempt) return sendJson(res, 200, null);
    return sendJson(res, 200, await learning.store.currentFeedback(attempt.attempt_id) ?? null);
  }

  if (req.method === 'GET' && url.pathname === `${LEARNING_PATH}/status`) {
    const jobId = url.searchParams.get('job_id');
    return sendJson(res, 200, jobId ? await learning.queue.get(jobId) ?? null : await learning.queue.counts());
  }

  return sendText(res, 404, 'not found');
}
