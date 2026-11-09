import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  readLimitedJson,
  requireJsonMethod,
  sameOrigin,
  sendCaughtError,
  sendJson,
  sendText,
  uncached,
} from '../http.js';
import type { ToolSettingsStore } from './settings.js';

export async function routeToolSettings(req: IncomingMessage, res: ServerResponse, store: ToolSettingsStore): Promise<void> {
  // Reading tool settings can start the local search service, so reads are guarded too.
  if (!sameOrigin(req)) return sendText(res, 403, 'Cross-origin tool settings are not allowed.');

  uncached(res);
  try {
    if (req.method === 'GET') return sendJson(res, 200, await store.current());

    if (!requireJsonMethod(req, res, 'PUT')) return;

    return sendJson(res, 200, await store.update(await readToolSettingsJson(req)));
  } catch (error) {
    return sendCaughtError(res, error, 'Tool settings unavailable. Retry.', 'error');
  }
}

function readToolSettingsJson(req: IncomingMessage): Promise<unknown> {
  return readLimitedJson(req, {
    bytes: 4096,
    tooLarge: 'Tool settings request exceeds 4 KB.',
    malformed: 'Malformed tool settings JSON.',
  });
}
