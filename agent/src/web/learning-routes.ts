import { routeDreaming } from './dreaming-routes.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  FEEDBACK_LABELS,
  type FeedbackLabel,
  type FeedbackRating,
} from '../core/learning/types.js';
import type { LearningService } from '../core/learning/service.js';
import { LearningSettingsError } from '../core/learning/preferences.js';
import { reviewDashboard } from '../core/learning/review.js';
import { readJson, sameOrigin, sendJson, sendText } from './http.js';
import { isValidSessionId, type WebSessionStore } from './sessions/store.js';

export const LEARNING_PATH = '/api/learning';

export async function routeLearning(
  req: IncomingMessage,
  res: ServerResponse,
  learning: LearningService,
  sessions: WebSessionStore,
  url: URL,
): Promise<void> {
  if (
    url.pathname === `${LEARNING_PATH}/dreaming` ||
    url.pathname.startsWith(`${LEARNING_PATH}/dreaming/`)
  )
    return routeDreaming(req, res, learning, url);

  if (url.pathname === `${LEARNING_PATH}/settings`)
    return routeLearningSettings(req, res, learning);

  if (req.method === 'POST' && url.pathname === `${LEARNING_PATH}/feedback`)
    return postFeedback(req, res, learning, sessions);

  if (req.method === 'GET' && url.pathname === `${LEARNING_PATH}/feedback`)
    return getFeedback(res, learning, url);

  if (req.method === 'GET' && url.pathname === `${LEARNING_PATH}/status`)
    return getLearningStatus(res, learning, url);

  if (req.method === 'GET' && url.pathname === `${LEARNING_PATH}/review`) {
    return sendJson(res, 200, await reviewDashboard(learning.datasets));
  }

  if (url.pathname.startsWith(`${LEARNING_PATH}/review/`))
    return reviewExample(req, res, learning, url);

  return sendText(res, 404, 'not found');
}

async function routeLearningSettings(
  req: IncomingMessage,
  res: ServerResponse,
  learning: LearningService,
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return sendJson(res, 200, await learning.getSettings());

  if (req.method !== 'PUT') return sendText(res, 405, 'method not allowed');

  if (!sameOrigin(req)) return sendText(res, 403, 'cross-origin settings changes are not allowed');

  if (!req.headers['content-type']?.startsWith('application/json'))
    return sendText(res, 415, 'application/json required');

  try {
    return sendJson(res, 200, await learning.updateSettings(await readJson(req)));
  } catch (error) {
    if (error instanceof LearningSettingsError) return sendText(res, 400, error.message);

    throw error;
  }
}

async function postFeedback(
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

async function getFeedback(
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

async function getLearningStatus(
  res: ServerResponse,
  learning: LearningService,
  url: URL,
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  if (url.searchParams.get('view') === 'activity')
    return sendJson(res, 200, { working: learning.isUpdating() });

  const jobId = url.searchParams.get('job_id');

  return sendJson(
    res,
    200,
    jobId
      ? ((await learning.queue.get(jobId)) ?? null)
      : {
          ...(await learning.queue.counts()),
          active: await learning.activeJobs(),
          working: learning.isUpdating(),
        },
  );
}

async function reviewExample(
  req: IncomingMessage,
  res: ServerResponse,
  learning: LearningService,
  url: URL,
): Promise<void> {
  const id = url.pathname.slice(`${LEARNING_PATH}/review/`.length);
  if (!/^example-[a-f0-9]{24}$/.test(id)) return sendText(res, 400, 'invalid example id');

  if (req.method === 'GET') {
    const example = (await learning.datasets.list('candidates')).find((row) => row.id === id);

    return example ? sendJson(res, 200, example) : sendText(res, 404, 'candidate not found');
  }

  if (req.method !== 'POST') return sendText(res, 405, 'method not allowed');

  const body = await readJson(req);
  if (!body || !['training', 'eval', 'dismiss'].includes(String(body.decision))) {
    return sendText(res, 400, 'invalid review decision');
  }

  const settings = learning.settings;
  if (
    !settings.enabled ||
    !settings.datasets ||
    (body.decision === 'training' && !settings.training) ||
    (body.decision === 'eval' && !settings.evals)
  )
    return sendText(res, 409, 'This review component is paused. Enable it in Settings → Learning.');

  const oracle = reviewOracle(body.oracle);
  if (body.oracle !== undefined && !oracle) return sendText(res, 400, 'invalid reviewed evidence');

  return applyReview(res, learning, id, body, oracle);
}

async function applyReview(
  res: ServerResponse,
  learning: LearningService,
  id: string,
  body: Record<string, unknown>,
  oracle?: Record<string, unknown>,
): Promise<void> {
  try {
    const result =
      body.decision === 'dismiss'
        ? await learning.datasets.dismiss(id)
        : await learning.datasets.promote(id, body.decision as 'training' | 'eval', {
            provenance: 'user_confirmed',
            ...(oracle ? { oracle } : {}),
          });

    return sendJson(res, 201, result);
  } catch (error) {
    const message = String(error);
    if (message.includes('candidate not found')) return sendText(res, 404, 'candidate not found');

    if (/stale|obsolete|already|duplicate|in progress/.test(message))
      return sendText(res, 409, message);

    if (/requires|unknown review/.test(message)) return sendText(res, 400, message);

    throw error;
  }
}

function feedbackInput(body: Record<string, unknown> | null | undefined) {
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

function reviewOracle(input: unknown): Record<string, unknown> | undefined {
  if (input === undefined) return undefined;

  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;

  const fields = input as Record<string, unknown>;
  const allowed = [
    'files',
    'symbols',
    'repositories',
    'dependency_path',
    'verified_negatives',
    'notes',
  ];

  if (!Object.keys(fields).length || Object.keys(fields).some((key) => !allowed.includes(key)))
    return undefined;

  for (const [key, value] of Object.entries(fields)) {
    if (key === 'notes') {
      if (typeof value !== 'string' || !value.trim() || value.length > 4_000) return undefined;
    } else if (
      !Array.isArray(value) ||
      value.length > 50 ||
      value.some((item) => typeof item !== 'string' || !item.trim() || item.length > 500)
    )
      return undefined;
  }

  return fields;
}
