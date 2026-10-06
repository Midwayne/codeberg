import type { IncomingMessage, ServerResponse } from 'node:http';
import { routeDreaming } from './dreaming-routes.js';
import { getFeedback, postFeedback } from './learning/feedback-routes.js';
import { reviewExample } from './learning/review-routes.js';

import { LearningSettingsError } from '../core/learning/preferences.js';
import { reviewDashboard } from '../core/learning/review.js';
import type { LearningService } from '../core/learning/service.js';
import { readJson, sameOrigin, sendJson, sendText } from './http.js';
import { type WebSessionStore } from './sessions/store.js';

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
