import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { pipeAgentUIStreamToResponse, type ToolLoopAgent } from 'ai';

import { promptCommandCatalog, type PromptCommand } from '../core/hooks/index.js';
import { CHAT_PAGE_HTML } from './page.js';
import { readJson, sendJson, sendText } from './http.js';
import { routeSessions } from './session-routes.js';
import { serveStatic } from './static.js';
import { WebSessionStore } from './sessions.js';

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

/** Builds (but does not start) the HTTP server. Call `.listen()` to run it. */
export function createWebServer(opts: WebServerOptions): Server {
  return createServer(createRequestHandler(opts));
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
