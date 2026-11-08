import { type IncomingMessage, type ServerResponse } from 'node:http';
import { readJson, requireJsonMethod, requireMethod, sendJson, sendText } from '../http.js';
import { ResourceSettings } from '../resources.js';
import { ResourceSettingsError } from '../resources/types.js';

export async function routeResources(
  req: IncomingMessage,
  res: ServerResponse,
  resources: ResourceSettings,
  url: URL,
): Promise<void> {
  const path = url.pathname;

  try {
    res.setHeader('Cache-Control', 'no-store');
    if (path === '/api/settings/resources') {
      if (!requireMethod(req, res, 'GET')) return;

      const after = url.searchParams.get('after') ?? '0';
      if (!/^\d+$/.test(after) || !Number.isSafeInteger(Number(after)))
        throw new ResourceSettingsError('invalid history cursor');

      const body = await resources.usage(Number(after));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(body);
      return;
    }

    if (req.method === 'GET') {
      const days = url.searchParams.get('olderThanDays') ?? '30';
      if (!/^\d+$/.test(days)) throw new ResourceSettingsError('invalid cleanup age');

      return sendJson(res, 200, await resources.preview(Number(days)));
    }

    if (!requireJsonMethod(req, res, 'POST')) return;

    const body = await readJson(req);

    return sendJson(res, 200, await resources.cleanup(body));
  } catch (error) {
    if (error instanceof ResourceSettingsError) return sendText(res, error.status, error.message);

    throw error;
  }
}
