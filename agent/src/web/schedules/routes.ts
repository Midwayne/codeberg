import { backgroundSchedules, cancelBackground } from '../background/visibility.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ScheduleSummary } from '../../core/schedules/summary.js';
import { requireJsonMutation, sendJson, sendText } from '../http.js';
import type { SearchRuns } from '../runs/manager.js';
import { requestId, type ScheduledRun } from './types.js';

/** Human controls span all chats of the selected project; agent tools stay chat-scoped. */
export async function routeSchedules(req: IncomingMessage, res: ServerResponse, url: URL, runs: SearchRuns) {
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/api/schedules') {
    if (req.method !== 'GET') return sendText(res, 405, 'method not allowed');

    const jobs = await runs.schedules.listAll();

    return sendJson(res, 200, [...await Promise.all(jobs.map((job) => summarize(runs, job))), ...await backgroundSchedules(runs)]);
  }

  const match = /^\/api\/schedules\/([A-Za-z0-9_-]{1,64})\/cancel$/.exec(url.pathname);
  if (!match) return sendText(res, 404, 'not found');
  if (!requireJsonMutation(req, res, 'POST', 'schedule cancellations')) return;

  const job = (await runs.schedules.listAll()).find((item) => item.id === match[1]);
  if (!job) {
    const background = await cancelBackground(runs, match[1]!);

    return background ? sendJson(res, 200, background) : sendText(res, 404, 'Scheduled run not found in this project.');
  }

  await runs.schedules.cancel(job.chatId, job.id);
  const run = await runs.findRequest(job.chatId, requestId(job));
  const stopping = Boolean(run && !run.settled);
  // Acknowledge cancellation promptly even when a tool is still cleaning up.
  if (run && !run.settled) run.controller.abort('stop');

  return sendJson(res, 200, { id: job.id, stopping });
}

async function summarize(runs: SearchRuns, job: ScheduledRun): Promise<ScheduleSummary> {
  const session = await runs.sessions.load(job.chatId);
  const run = ['running', 'cancelled'].includes(job.status)
    ? await runs.findRequest(job.chatId, requestId(job)) : undefined;

  return { id: job.id, chatId: job.chatId, chatTitle: session?.title ?? 'Deleted chat', chatDeleted: !session,
    prompt: job.prompt, status: job.status, dueAt: job.dueAt, everySeconds: job.everySeconds,
    afterToolCallId: job.afterToolCallId, backgroundJobIds: job.backgroundJobIds, model: job.selection?.model, createdAt: job.createdAt,
    lastRunId: job.lastRunId, error: job.error,
    activeRun: run && !run.settled ? { id: run.record.id, stopping: run.controller.signal.aborted } : undefined };
}
