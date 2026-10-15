import type { IncomingMessage, ServerResponse } from 'node:http';
import { requireJsonMutation, sameOrigin, sendJson, sendText } from '../http.js';
import { ToolSettingsError, type ToolSettingsStore } from './settings.js';

export async function routeToolSettings(req: IncomingMessage, res: ServerResponse, store: ToolSettingsStore): Promise<void> {
  if (!sameOrigin(req)) return sendText(res, 403, 'Cross-origin tool settings are not allowed.');

  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') return sendJson(res, 200, await store.current());

    if (!requireJsonMutation(req, res, 'PUT', 'tool changes')) return;

    return sendJson(res, 200, await store.update(await readToolSettingsJson(req)));
  } catch (error) {
    return sendJson(res, error instanceof ToolSettingsError ? error.status : 503,
      { error: error instanceof Error ? error.message : 'Tool settings unavailable. Retry.' });
  }
}

async function readToolSettingsJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 4096) {
      req.resume();

      throw new ToolSettingsError('Tool settings request exceeds 4 KB.', 413);
    }

    chunks.push(bytes);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ToolSettingsError('Malformed tool settings JSON.');
  }
}
