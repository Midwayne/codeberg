import { forkChatCanvas } from '../../core/canvas/fork.js';
import type { CanvasStore } from '../../core/canvas/store.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { LearningService } from '../../core/learning/service.js';
import { writeModuleLog } from '../../core/module-log.js';
import { readJson, sendJson, sendText } from '../http.js';
import { WebSessionStore, isValidSessionId, normalizeSessionTitle } from './store.js';
import { readContextStats } from './context-stats.js';
import { readChatModel } from '../model-selection/chat-model.js';
import type { ModelSelection } from '../../core/model-types.js';

const SESSIONS_PATH = '/api/sessions';
const CONTEXT_SUFFIX = '/context';

/** Saved-chat collection and item routes; the client owns the conversation and id. */
export async function routeSessions(
  req: IncomingMessage,
  res: ServerResponse,
  store: WebSessionStore,
  path: string,
  learning?: LearningService,
  canvas?: CanvasStore,
): Promise<void> {
  const rest = decodeURIComponent(path.slice(SESSIONS_PATH.length).replace(/^\//, ''));

  // Collection: list saved chats.
  if (rest === '') return listSessions(req, res, store);

  // Context usage for one chat, recorded as its turns run.
  if (rest.endsWith(CONTEXT_SUFFIX)) {
    return routeContextStats(req, res, store, rest.slice(0, -CONTEXT_SUFFIX.length));
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
    case 'PUT':
      return saveSession(req, res, store, id, learning, canvas);
    case 'PATCH':
      return updateSession(req, res, store, id);
    case 'DELETE': {
      await store.remove(id);
      res.writeHead(204).end();
      return;
    }
    default:
      return sendText(res, 405, 'method not allowed');
  }
}

async function saveSession(
  req: IncomingMessage,
  res: ServerResponse,
  store: WebSessionStore,
  id: string,
  learning?: LearningService,
  canvas?: CanvasStore,
): Promise<void> {
  const body = await readJson(req);
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const rawTitle = typeof body?.title === 'string' ? body.title.trim() : '';
  const parentId = readParentId(body?.parentId, id);
  const model = readChatModel(body?.model);
  if (parentId) {
    const existing = await store.load(id);
    // A deleted parent must not prevent subsequent saves of its branch.
    if (existing?.parentId !== parentId && !(await store.load(parentId))) {
      return sendText(res, 404, 'parent conversation not found in this project');
    }
  }

  const record = await store.upsert({
    id,
    title: rawTitle || 'New chat',
    messages,
    ...(parentId ? { parentId } : {}),
    ...(model === undefined ? {} : { model }),
  });

  await forkChatCanvas(canvas, id, record.parentId);

  if (learning) {
    try {
      await learning.recordSession(id, record.messages, record.parentId);
    } catch (error) {
      // Chat persistence succeeded. A learning disk failure must not break it.
      console.error('learning session recording failed:', error);
      writeModuleLog('learning-agent', 'session_recording_failed', { error: String(error) });
    }
  }

  return sendJson(res, 200, { ok: true });
}

type SessionPatch = {
  title?: string;
  read?: true;
  model?: ModelSelection | null;
  flags: { pinned?: boolean; archived?: boolean };
};

async function updateSession(
  req: IncomingMessage,
  res: ServerResponse,
  store: WebSessionStore,
  id: string,
): Promise<void> {
  const patch = readSessionPatch(await readJson(req));
  if (!patch) {
    return sendText(res, 400, 'expected a title, pinned and archived booleans, a model, and/or read: true');
  }

  let record = patch.title === undefined ? undefined : await store.rename(id, patch.title);

  if (record !== null && Object.keys(patch.flags).length > 0) {
    record = await store.setFlags(id, patch.flags);
  }

  if (record !== null && patch.model !== undefined) {
    record = await store.setModel(id, patch.model);
  }

  if (record !== null && patch.read) {
    record = await store.markRead(id);
  }

  return record ? sendJson(res, 200, { ok: true }) : sendText(res, 404, 'not found');
}

/** Accepts only known fields, so a typo cannot silently do nothing. */
function readSessionPatch(body: unknown): SessionPatch | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length === 0) {
    return undefined;
  }

  const patch: SessionPatch = { flags: {} };

  for (const [key, value] of Object.entries(body)) {
    if (key === 'title') {
      const title = normalizeSessionTitle(value);
      if (!title) return undefined;

      patch.title = title;
    } else if ((key === 'pinned' || key === 'archived') && typeof value === 'boolean') {
      patch.flags[key] = value;
    } else if (key === 'read' && value === true) {
      patch.read = true;
    } else if (key === 'model' && readChatModel(value) !== undefined) {
      patch.model = readChatModel(value);
    } else {
      return undefined;
    }
  }

  return patch;
}

/** A valid session id that isn't the record itself — ignored otherwise. */
function readParentId(value: unknown, id: string): string | undefined {
  if (typeof value !== 'string' || value === id || !isValidSessionId(value)) {
    return undefined;
  }

  return value;
}

async function routeContextStats(req: IncomingMessage, res: ServerResponse, store: WebSessionStore, id: string): Promise<void> {
  if (req.method !== 'GET') return sendText(res, 405, 'method not allowed');

  if (!isValidSessionId(id)) return sendText(res, 400, 'invalid session id');

  return sendJson(res, 200, await readContextStats(store.dir, id));
}

async function listSessions(req: IncomingMessage, res: ServerResponse, store: WebSessionStore): Promise<void> {
  if (req.method !== 'GET') return sendText(res, 405, 'method not allowed');

  const query = new URL(req.url ?? '/', 'http://localhost').searchParams.get('q') ?? '';

  return sendJson(res, 200, await store.list(query));
}
