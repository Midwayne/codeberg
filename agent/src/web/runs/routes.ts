import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeUIMessageStreamToResponse, type UIMessage } from 'ai';
import type { ResolvedModelSelection } from '../chat-routes.js';
import { readJson, requireJsonMutation, sendJson, sendText } from '../http.js';
import type { SearchRuns } from './manager.js';
import { RunError, type SearchRun } from './types.js';

export async function submitSearch(res: ServerResponse, body: Record<string, unknown> | null,
  selection: ResolvedModelSelection | undefined, runs: SearchRuns): Promise<void> {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (!messages.length || messages.some((message) => !validMessage(message))) {
    return sendText(res, 400, 'expected UI messages with ids, roles, and parts');
  }

  const requestId = typeof body?.requestId === 'string' ? body.requestId
    : String(messages.at(-1).id);
  try {
    const run = await runs.admit({ chatId: typeof body?.id === 'string' ? body.id : randomUUID(),
      requestId, messages, selection, trigger: typeof body?.trigger === 'string' ? body.trigger : undefined });
    pipeRun(res, runs, run, 0);
  } catch (error) {
    if (!(error instanceof RunError)) throw error;

    sendText(res, error.status, error.message);
  }
}

export async function routeSearchRun(req: IncomingMessage, res: ServerResponse, url: URL, runs: SearchRuns) {
  const match = /^\/api\/chat\/([A-Za-z0-9_-]{1,64})\/(stream|stop|run)$/.exec(url.pathname);
  if (!match) return sendText(res, 404, 'not found');

  const [, chatId, action] = match;
  try {
    if (action === 'stop') {
      if (!requireJsonMutation(req, res, 'POST', 'search stops')) return;

      const body = await readJson(req);
      const id = body?.runId ?? body?.requestId;
      if (typeof id !== 'string') return sendText(res, 400, 'runId or requestId required');

      await runs.stop(chatId, id, !body?.runId);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method !== 'GET') return sendText(res, 405, 'method not allowed');

    const requestId = url.searchParams.get('requestId');
    const run = requestId !== null ? await runs.findRequest(chatId, requestId)
      : await runs.find(chatId, url.searchParams.get('runId') ?? undefined);
    if (!run) return action === 'stream' ? void res.writeHead(204).end() : sendText(res, 404, 'not found');

    if (action === 'run') return sendJson(res, 200, { id: run.record.id, requestId: run.record.requestId, status: run.record.status,
      createdAt: run.record.createdAt, finishedAt: run.record.finishedAt, error: run.record.error,
      messageId: run.events.find((event) => event.type === 'start')?.messageId, eventCount: run.events.length, tools: run.tools });

    pipeRun(res, runs, run, Number(url.searchParams.get('after') ?? 0));
  } catch (error) {
    if (!(error instanceof RunError)) throw error;

    sendText(res, error.status, error.message);
  }
}

function pipeRun(res: ServerResponse, runs: SearchRuns, run: SearchRun, after: number) {
  pipeUIMessageStreamToResponse({ response: res, stream: runs.stream(run, after), keepAliveMs: 15_000,
    headers: { 'x-codeberg-run': run.record.id, 'x-codeberg-status': run.record.status } });
  // A run can be waiting for its first provider event when a client disconnects.
  res.flushHeaders();
}

function validMessage(value: unknown): value is UIMessage {
  if (!value || typeof value !== 'object') return false;

  const message = value as UIMessage;

  return typeof message.id === 'string' && ['user', 'assistant', 'system'].includes(message.role)
    && Array.isArray(message.parts);
}
