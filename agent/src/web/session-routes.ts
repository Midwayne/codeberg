import type { IncomingMessage, ServerResponse } from 'node:http';

import { readJson, sendJson, sendText } from './http.js';
import { WebSessionStore, isValidSessionId } from './sessions.js';
import type { LearningService } from '../core/learning/service.js';

const SESSIONS_PATH = '/api/sessions';

/** Saved-chat collection and item routes; the client owns the conversation and id. */
export async function routeSessions(
  req: IncomingMessage,
  res: ServerResponse,
  store: WebSessionStore,
  path: string,
  learning?: LearningService,
): Promise<void> {
  const rest = decodeURIComponent(path.slice(SESSIONS_PATH.length).replace(/^\//, ''));

  // Collection: list saved chats.
  if (rest === '') {
    if (req.method !== 'GET') {
      return sendText(res, 405, 'method not allowed');
    }
    const query = new URL(req.url ?? '/', 'http://localhost').searchParams.get('q') ?? '';
    return sendJson(res, 200, await store.list(query));
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
      const parentId = readParentId(body?.parentId, id);
      const record = await store.upsert({
        id,
        title: rawTitle || 'New chat',
        messages,
        ...(parentId ? { parentId } : {}),
      });
      if (learning) {
        try {
          await learning.recordSession(id, messages, record.parentId);
        } catch (error) {
          // Chat persistence succeeded. A learning disk failure must not break it.
          console.error('learning session recording failed:', error);
        }
      }
      return sendJson(res, 200, { ok: true });
    }
    case 'PATCH': {
      const body = await readJson(req);
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).length === 0 ||
          Object.entries(body).some(([key, value]) =>
            (key !== 'pinned' && key !== 'archived') || typeof value !== 'boolean')) {
        return sendText(res, 400, 'expected pinned and/or archived booleans');
      }
      const record = await store.setFlags(id, body as { pinned?: boolean; archived?: boolean });
      return record ? sendJson(res, 200, { ok: true }) : sendText(res, 404, 'not found');
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
