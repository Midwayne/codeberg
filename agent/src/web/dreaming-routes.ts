import type { IncomingMessage, ServerResponse } from 'node:http';
import { dreamingSummary } from '../core/learning/dreaming/review.js';
import type { DreamingDecision } from '../core/learning/dreaming/types.js';
import { redactSecrets } from '../core/learning/redact.js';
import type { LearningService } from '../core/learning/service.js';
import { readJson, sendJson, sendText } from './http.js';

const PATH = '/api/learning/dreaming';

export async function routeDreaming(
  req: IncomingMessage,
  res: ServerResponse,
  learning: LearningService,
  url: URL,
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  const invalidWrite = validateDreamingWrite(req);
  if (invalidWrite) return sendText(res, invalidWrite.status, invalidWrite.message);

  try {
    if (url.pathname === PATH) {
      return await routeDreamingRoot(req, res, learning);
    }

    const id = url.pathname.slice(PATH.length + 1);
    if (!/^dream-[a-z0-9-]{1,70}$/.test(id))
      return sendText(res, 400, 'invalid dreaming report id');

    if (req.method === 'GET') {
      const report = await learning.dreamingReports.get(id);

      return report ? sendJson(res, 200, report) : sendText(res, 404, 'dreaming report not found');
    }

    if (req.method !== 'POST') return sendText(res, 405, 'method not allowed');

    const body = await readJson(req);
    if (
      !body ||
      typeof body.action !== 'string' ||
      !['apply', 'undo', 'dismiss'].includes(body.action)
    )
      return sendText(res, 400, 'invalid dreaming action');

    return sendJson(res, 200, await learning.decideDreaming(id, body.action as DreamingDecision));
  } catch (error) {
    const message = String(error);
    if (message.includes('not found')) return sendText(res, 404, message);

    if (/paused|no learning model|stale|already|no changes/.test(message))
      return sendText(res, 409, message);

    throw error;
  }
}

async function routeDreamingRoot(
  req: IncomingMessage,
  res: ServerResponse,
  learning: LearningService,
): Promise<void> {
  if (req.method === 'POST') return sendJson(res, 202, await learning.requestDreaming());

  if (req.method !== 'GET') return sendText(res, 405, 'method not allowed');

  const [reports, pending, processing, failed] = await Promise.all([
    learning.dreamingReports.list(),
    learning.queue.list('pending'),
    learning.queue.list('processing'),
    learning.queue.list('failed'),
  ]);

  return sendJson(res, 200, {
    reports: reports.slice(0, 20).map(dreamingSummary),
    jobs: [...pending, ...processing, ...failed]
      .filter((job) => job.type === 'consolidate_knowledge')
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 5)
      .map(({ job_id, interaction_id, status, last_error, next_attempt_at }) => ({
        job_id,
        interaction_id,
        status,
        last_error: redactSecrets(last_error),
        next_attempt_at,
      })),
    canGenerate: learning.knowledgeEnabled,
  });
}

function validateDreamingWrite(
  req: IncomingMessage,
): { status: number; message: string } | undefined {
  if (req.method === 'POST') {
    if (
      req.headers.origin &&
      req.headers.origin !== `http://${req.headers.host}` &&
      req.headers.origin !== `https://${req.headers.host}`
    )
      return { status: 403, message: 'cross-origin knowledge changes are not allowed' };

    if (!req.headers['content-type']?.startsWith('application/json'))
      return { status: 415, message: 'application/json required' };
  }

  return undefined;
}
