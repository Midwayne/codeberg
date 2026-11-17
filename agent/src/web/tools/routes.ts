import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody, requireJsonMutation, sameOrigin, sendJson, sendText } from '../http.js';
import { ToolSettingsError, type ToolSettingsStore } from './settings.js';
import { HttpError } from '../../core/http-error.js';
import { errorMessage } from '../../core/errors.js';

export async function routeToolSettings(req: IncomingMessage, res: ServerResponse, store: ToolSettingsStore): Promise<void> {
  if (!sameOrigin(req)) return sendText(res, 403, 'Cross-origin tool settings are not allowed.');

  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') return sendJson(res, 200, await store.current());

    if (!requireJsonMutation(req, res, 'PUT', 'tool changes')) return;

    return sendJson(res, 200, await store.update(await readToolSettingsJson(req)));
  } catch (error) {
    return sendJson(res, error instanceof HttpError ? error.status : 503,
      { error: errorMessage(error, 'Tool settings unavailable. Retry.') });
  }
}

async function readToolSettingsJson(req: IncomingMessage): Promise<unknown> {
  const body = await readBody(req, 4096, 'Tool settings request exceeds 4 KB.');

  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new ToolSettingsError('Malformed tool settings JSON.');
  }
}
