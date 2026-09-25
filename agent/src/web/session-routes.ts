import type { IncomingMessage, ServerResponse } from 'node:http';

import { readJson, sendJson, sendText } from './http.js';
import { WebSessionStore, isValidSessionId } from './sessions.js';

const SESSIONS_PATH = '/api/sessions';

/** Saved-chat collection and item routes; the client owns the conversation and id. */
export async function routeSessions(
  req: IncomingMessage,
  res: ServerResponse,
  store: WebSessionStore,
  path: string,
): Promise<void> {
  const rest = decodeURIComponent(path.slice(SESSIONS_PATH.length).replace(/^\//, ''));

  // Collection: list saved chats.
  if (rest === '') {
    if (req.method !== 'GET') {
      return sendText(res, 405, 'method not allowed');
    }
    return sendJson(res, 200, await store.list());
  }

  // Item: one chat by id.
  const id = rest;
  if (!isValidSessionId(id)) {
    return sendText(res, 400, 'invalid session id');
  }

  switch (req.method) {
    case 'GET': {
      const record = await store.load(id);
      return record ? sendJson(res, 200, record) : sendText(res, 404, 'not found');
    }
    case 'PUT': {
      const body = await readJson(req);
      const messages = Array.isArray(body?.messages) ? body.messages : [];
      const rawTitle = typeof body?.title === 'string' ? body.title.trim() : '';
      const now = Date.now();
      const existing = await store.load(id);
      const parentId = readParentId(body?.parentId, id) ?? existing?.parentId;
      await store.save({
        id,
        title: rawTitle || 'New chat',
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        messages,
        ...(parentId ? { parentId } : {}),
      });
      return sendJson(res, 200, { ok: true });
    }
    case 'DELETE': {
      await store.remove(id);
      res.writeHead(204).end();
      return;
    }
    default:
      return sendText(res, 405, 'method not allowed');
  }
}

/** A valid session id that isn't the record itself — ignored otherwise. */
function readParentId(value: unknown, id: string): string | undefined {
  if (typeof value !== 'string' || value === id || !isValidSessionId(value)) {
    return undefined;
  }
  return value;
}
