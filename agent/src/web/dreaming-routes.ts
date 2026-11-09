import type { IncomingMessage, ServerResponse } from 'node:http';
import { isDreamingReportId } from '../core/learning/dreaming/reports.js';
import { dreamingSummary } from '../core/learning/dreaming/review.js';
import type { DreamingDecision } from '../core/learning/dreaming/types.js';
import type { LearningService } from '../core/learning/service.js';
import { readJson, requireApplicationJson, requireMethod, sendJson, sendText, uncached } from './http.js';
import { sendLearningError } from './learning/errors.js';
import { LEARNING_PATH } from './learning/paths.js';
import { queueJobsByType } from './learning/queue-jobs.js';

const PATH = `${LEARNING_PATH}/dreaming`;

export async function routeDreaming(
  req: IncomingMessage,
  res: ServerResponse,
  learning: LearningService,
  url: URL,
): Promise<void> {
  uncached(res);
  if (req.method === 'POST' && !requireApplicationJson(req, res)) return;

  try {
    if (url.pathname === PATH) {
      return await routeDreamingRoot(req, res, learning);
    }

    const id = url.pathname.slice(PATH.length + 1);
    if (!isDreamingReportId(id)) return sendText(res, 400, 'invalid dreaming report id');

    if (req.method === 'GET') {
      const report = await learning.dreamingReports.get(id);

      return report ? sendJson(res, 200, report) : sendText(res, 404, 'dreaming report not found');
    }

    if (!requireMethod(req, res, 'POST')) return;

    const body = await readJson(req);
    if (
      !body ||
      typeof body.action !== 'string' ||
      !['apply', 'undo', 'dismiss'].includes(body.action)
    )
      return sendText(res, 400, 'invalid dreaming action');

    return sendJson(res, 200, await learning.decideDreaming(id, body.action as DreamingDecision));
  } catch (error) {
    return sendLearningError(res, error);
  }
}

async function routeDreamingRoot(
  req: IncomingMessage,
  res: ServerResponse,
  learning: LearningService,
): Promise<void> {
  if (req.method === 'POST') return sendJson(res, 202, await learning.requestDreaming());

  if (!requireMethod(req, res, 'GET')) return;

  const [reports, jobs] = await Promise.all([
    learning.dreamingReports.list(),
    queueJobsByType(learning, 'consolidate_knowledge'),
  ]);

  return sendJson(res, 200, {
    reports: reports.slice(0, 20).map(dreamingSummary),
    jobs: jobs
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 5)
      .map(({ job_id, interaction_id, status, last_error, next_attempt_at }) => ({
        job_id,
        interaction_id,
        status,
        last_error,
        next_attempt_at,
      })),
    canGenerate: learning.knowledgeEnabled,
  });
}
