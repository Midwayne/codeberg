import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

import { pipeAgentUIStreamToResponse, type ToolLoopAgent } from 'ai';

import { promptCommandCatalog, type PromptCommand } from '../core/hooks/index.js';
import { CHAT_PAGE_HTML } from './page.js';
import { WebSessionStore, isValidSessionId } from './sessions.js';

/** The endpoint the browser chat client posts its message history to. */
export const CHAT_PATH = '/api/chat';
/** Lightweight metadata (active model/daemon) for the UI title bar. */
export const META_PATH = '/api/meta';
/** Slash-command catalog (e.g. `/enhance`) for the composer autocomplete. */
export const COMMANDS_PATH = '/api/commands';
/** Saved-chat CRUD: list (`GET`), and load/save/delete one at `/api/sessions/<id>`. */
export const SESSIONS_PATH = '/api/sessions';

/** Streams an agent turn to a Node response, given the client's UI messages. */
export type ChatResponder = (res: ServerResponse, messages: unknown[]) => Promise<void>;

export interface WebServerOptions {
  /** The ai-sdk agent driving each turn — the same one `runAgentTUI` uses. */
  agent: ToolLoopAgent;
  /** Shown in the page title bar; also returned from `/api/meta`. */
  title: string;
  /**
   * Directory of the built React SPA (`web-ui/dist`). When present, it is
   * served at `/`; when absent or unbuilt, the dependency-free fallback page is
   * served instead, so `codeberg-web` works with no frontend build step.
   */
  staticRoot?: string;
  /**
   * How a chat turn is streamed back. Defaults to piping the agent's
   * UI-message stream. Override to layer on auth, persistence, or to test the
   * routing without a live model.
   */
  respond?: ChatResponder;
  /**
   * Backs the `/api/sessions` routes that persist browser chats so they can be
   * listed and resumed. Defaults to a `WebSessionStore` under `<CODEBERG_HOME>/
   * web-sessions`; inject one (e.g. a temp dir) in tests.
   */
  sessionStore?: WebSessionStore;
  /**
   * Slash commands served at `/api/commands` for the composer autocomplete.
   * Defaults to the built-in hook catalog, so a newly registered prompt hook
   * shows up in the UI without any wiring here.
   */
  commands?: PromptCommand[];
}

/**
 * The request handler bridging a browser chat client to the code-search agent.
 *
 * The chat route is intentionally stateless: the client holds the conversation
 * and posts the full message array each turn, so a request maps straight onto
 * `pipeAgentUIStreamToResponse` — no server-side session (unlike the TUI, which
 * layers its own session store onto runAgentTUI's single seam).
 */
export function createRequestHandler(
  opts: WebServerOptions,
): (req: IncomingMessage, res: ServerResponse) => void {
  const respond: ChatResponder =
    opts.respond ??
    ((res, messages) =>
      pipeAgentUIStreamToResponse({
        response: res,
        agent: opts.agent,
        uiMessages: messages,
      }));
  const sessions = opts.sessionStore ?? new WebSessionStore();

  return (req, res) => {
    route(req, res, opts, respond, sessions).catch((err: unknown) => {
      // `respond` writes the SSE headers itself, so only set a status if the
      // stream had not started yet.
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end(`internal error: ${String(err)}`);
    });
  };
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  opts: WebServerOptions,
  respond: ChatResponder,
  sessions: WebSessionStore,
): Promise<void> {
  const path = (req.url ?? '/').split('?')[0];

  if (req.method === 'POST' && path === CHAT_PATH) {
    const body = await readJson(req);
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    await respond(res, messages);
    return;
  }

  if (req.method === 'GET' && path === META_PATH) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ title: opts.title }));
    return;
  }

  if (req.method === 'GET' && path === COMMANDS_PATH) {
    sendJson(res, 200, opts.commands ?? promptCommandCatalog());
    return;
  }

  if (path === SESSIONS_PATH || path.startsWith(SESSIONS_PATH + '/')) {
    await routeSessions(req, res, sessions, path);
    return;
  }

  // Unknown API routes 404 rather than falling through to the SPA, so a bad
  // method or path doesn't silently return HTML.
  if (path.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }

  if (req.method === 'GET') {
    if (await serveStatic(res, opts.staticRoot, path)) {
      return;
    }
    // Fallback: the embedded dependency-free page (no build needed).
    const html = CHAT_PAGE_HTML.replaceAll('{{TITLE}}', escapeHtml(opts.title));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
}

/**
 * The `/api/sessions` surface: `GET /api/sessions` lists saved chats; `GET`,
 * `PUT`, and `DELETE` on `/api/sessions/<id>` load, upsert, and remove one. The
 * client owns the conversation and the id (so persistence is just CRUD over the
 * store), and the id charset is validated up front against path traversal.
 */
async function routeSessions(
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
      await store.save({
        id,
        title: rawTitle || 'New chat',
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        messages,
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

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

/**
 * Serves the built SPA: hashed assets by exact path, every other route falling
 * back to `index.html`. Returns false if no build is present, so the caller can
 * serve the embedded fallback page.
 */
async function serveStatic(
  res: ServerResponse,
  staticRoot: string | undefined,
  urlPath: string,
): Promise<boolean> {
  if (!staticRoot) {
    return false;
  }

  if (urlPath !== '/') {
    const file = safeJoin(staticRoot, urlPath);
    if (file) {
      try {
        const data = await readFile(file);
        res.writeHead(200, {
          'Content-Type': contentType(file),
          'Cache-Control': 'public, max-age=31536000, immutable',
        });
        res.end(data);
        return true;
      } catch {
        // not an asset — fall through to the SPA index
      }
    }
  }

  try {
    const html = await readFile(join(staticRoot, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return true;
  } catch {
    return false;
  }
}

/** Builds (but does not start) the HTTP server. Call `.listen()` to run it. */
export function createWebServer(opts: WebServerOptions): Server {
  return createServer(createRequestHandler(opts));
}

/** Joins a URL path under root, returning null on any traversal escape. */
function safeJoin(root: string, urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath);
  const full = resolve(join(root, decoded));
  const base = resolve(root);
  return full === base || full.startsWith(base + sep) ? full : null;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8',
};

function contentType(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) {
    return null;
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
