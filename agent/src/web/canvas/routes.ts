import type { IncomingMessage, ServerResponse } from 'node:http';
import { CanvasStore } from '../../core/canvas/store.js';
import { HttpError } from '../../core/api/errors.js';
import { CanvasError } from '../../core/canvas/types.js';
import { writeModuleLog } from '../../core/module-log.js';
import {
  isLoopbackHost,
  notFound,
  readLimitedJson,
  requireJsonMethod,
  sameOrigin,
  sendJson,
  sendText,
  uncached,
} from '../http.js';
import { streamCanvas } from './stream.js';

export async function routeCanvas(req: IncomingMessage, res: ServerResponse, store: CanvasStore, url: URL): Promise<void> {
  const host = new URL(`http://${req.headers.host ?? 'invalid'}`).hostname;
  // Canvas scenes are only exposed to a local browser, even for reads.
  if (!isLoopbackHost(host) || !sameOrigin(req)) {
    return sendText(res, 403, 'Canvas requires a same-origin localhost connection.');
  }
  uncached(res);
  try {
    await canvasRequest(req, res, store, url);
  } catch (error) {
    writeModuleLog('agent', 'canvas_request_failed', { error: String(error) });
    sendJson(res, error instanceof HttpError ? error.status : 503,
      { error: error instanceof Error ? error.message : 'Canvas unavailable. Retry.' });
  }
}

async function canvasRequest(req: IncomingMessage, res: ServerResponse, store: CanvasStore, url: URL): Promise<void> {
  const path = url.pathname;
  if (path === '/api/settings/canvas') {
    if (req.method === 'GET') return sendJson(res, 200, await store.settings());

    if (!requireJsonMethod(req, res, 'PUT')) return;

    const input = await readCanvasJson(req);
    if (typeof input.enabled !== 'boolean') throw new CanvasError('enabled must be a boolean.');

    return sendJson(res, 200, await store.configure(input.enabled));
  }
  await store.requireEnabled();
  if (!['/api/canvas/events', '/api/canvas/scene'].includes(path)) return notFound(res);

  store = store.forChat(url.searchParams.get('chat') ?? '');
  if (req.method === 'GET') {
    if (path === '/api/canvas/events') return streamCanvas(req, res, store);

    if (path === '/api/canvas/scene') return sendJson(res, 200, await store.current());

    return notFound(res);
  }
  if (!requireJsonMethod(req, res, 'POST')) return;

  const input = await readCanvasJson(req);
  if (path === '/api/canvas/scene') return sendJson(res, 200, await store.saveBrowser(input));

  return notFound(res);
}

async function readCanvasJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const value = await readLimitedJson(req, {
    bytes: 20_000_000,
    tooLarge: 'Canvas request exceeds 20 MB.',
    malformed: 'Malformed canvas JSON.',
  });
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CanvasError('Malformed canvas JSON.');
  }

  return value as Record<string, unknown>;
}
