import type { IncomingMessage, ServerResponse } from 'node:http';
import { CanvasStore } from '../../core/canvas/store.js';
import { CanvasError, type Scene } from '../../core/canvas/types.js';
import { writeModuleLog } from '../../core/module-log.js';
import { requireJsonMutation, sameOrigin, sendJson, sendText } from '../http.js';

export async function routeCanvas(req: IncomingMessage, res: ServerResponse, store: CanvasStore, url: URL): Promise<void> {
  const host = new URL(`http://${req.headers.host ?? 'invalid'}`).hostname;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host) || !sameOrigin(req)) {
    return sendText(res, 403, 'Canvas requires a same-origin localhost connection.');
  }
  res.setHeader('Cache-Control', 'no-store');
  try {
    await canvasRequest(req, res, store, url);
  } catch (error) {
    writeModuleLog('agent', 'canvas_request_failed', { error: String(error) });
    sendJson(res, error instanceof CanvasError ? error.status : 503,
      { error: error instanceof Error ? error.message : 'Canvas unavailable. Retry.' });
  }
}

async function canvasRequest(req: IncomingMessage, res: ServerResponse, store: CanvasStore, url: URL): Promise<void> {
  const path = url.pathname;
  if (path === '/api/settings/canvas') {
    if (req.method === 'GET') return sendJson(res, 200, await store.settings());

    if (!requireJsonMutation(req, res, 'PUT', 'canvas changes')) return;

    const input = await readCanvasJson(req);
    if (typeof input.enabled !== 'boolean') throw new CanvasError('enabled must be a boolean.');

    return sendJson(res, 200, await store.configure(input.enabled));
  }
  await store.requireEnabled();
  if (path !== '/api/canvas/scene') return sendText(res, 404, 'not found');

  store = store.forChat(url.searchParams.get('chat') ?? '');
  if (req.method === 'GET') return sendScene(req, res, await store.current());

  if (!requireJsonMutation(req, res, 'POST', 'canvas changes')) return;

  const input = await readCanvasJson(req);

  return sendJson(res, 200, await store.saveBrowser(input));
}

/** Browser previews poll; unchanged scenes cost an empty 304, not a held connection. */
function sendScene(req: IncomingMessage, res: ServerResponse, scene: Scene): void {
  const tag = `"${scene.name}:${scene.revision}"`;
  res.setHeader('ETag', tag);

  if (req.headers['if-none-match'] === tag) {
    res.writeHead(304).end();
    return;
  }

  sendJson(res, 200, scene);
}

async function readCanvasJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 20_000_000) throw new CanvasError('Canvas request exceeds 20 MB.', 413);

    chunks.push(Buffer.from(chunk));
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();

    return value;
  } catch {
    throw new CanvasError('Malformed canvas JSON.');
  }
}
