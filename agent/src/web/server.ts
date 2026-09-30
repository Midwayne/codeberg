import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

import { pipeAgentUIStreamToResponse, type ToolLoopAgent } from 'ai';

import { promptCommandCatalog, type PromptCommand } from '../core/hooks/index.js';
import { writeModuleLog } from '../core/module-log.js';
import { CHAT_PAGE_HTML } from './page.js';
import { readJson, sendJson, sendText } from './http.js';
import { routeChat, routeMeta, type ChatResponder, type ResolvedModelSelection } from './chat-routes.js';
import { routeSessions } from './sessions/routes.js';
import { serveStatic } from './static.js';
import { WebSessionStore } from './sessions/store.js';
import { LEARNING_PATH, routeLearning } from './learning-routes.js';
import type { LearningService } from '../core/learning/service.js';
import { ModelSelectionError, type ModelSettingsStore } from './model-selection/settings.js';
import { ResourceSettings, ResourceSettingsError } from './resources.js';

/** The endpoint the browser chat client posts its message history to. */
export const CHAT_PATH = '/api/chat';
/** Lightweight metadata (active model/daemon) for the UI title bar. */
export const META_PATH = '/api/meta';
/** Slash-command catalog (e.g. `/enhance`) for the composer autocomplete. */
export const COMMANDS_PATH = '/api/commands';
/** Saved-chat CRUD: list (`GET`), and load/save/delete one at `/api/sessions/<id>`. */
export const SESSIONS_PATH = '/api/sessions';
export const CHAT_SEARCH_PATH = '/api/chat-search';
export const MODELS_PATH = '/api/models';
export { LEARNING_PATH };

/** Streams an agent turn to a Node response, given the client's UI messages. */
export type { ChatResponder, ResolvedModelSelection } from './chat-routes.js';

export interface WebServerOptions {
  /** The ai-sdk agent driving each turn. */
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
  /** Durable interaction/feedback/knowledge subsystem. */
  learning?: LearningService;
  /** Persistent catalog and UI choices. Omitted for servers without model selection. */
  modelSettings?: ModelSettingsStore;
  /** Resolve and cache a model-bound agent for this request's selection. */
  selectAgent?: (selection: ResolvedModelSelection) => Promise<ToolLoopAgent>;
  /**
   * Slash commands served at `/api/commands` for the composer autocomplete.
   * Defaults to the built-in hook catalog, so a newly registered prompt hook
   * shows up in the UI without any wiring here.
   */
  commands?: PromptCommand[];
  /** Local monitoring/cleanup service. The server owns its sampling lifecycle. */
  resources?: ResourceSettings;
}

/**
 * The request handler bridging a browser chat client to the code-search agent.
 *
 * The chat route is intentionally stateless: the client holds the conversation
 * and posts the full message array each turn, so a request maps straight onto
 * `pipeAgentUIStreamToResponse`; persistence is handled by the session routes.
 */
export function createRequestHandler(
  opts: WebServerOptions,
): (req: IncomingMessage, res: ServerResponse) => void {
  const respond: ChatResponder =
    opts.respond ??
    (async (res, messages, selection) =>
      pipeAgentUIStreamToResponse({
        response: res,
        agent: selection && opts.selectAgent ? await opts.selectAgent(selection) : opts.agent,
        uiMessages: messages,
      }));
  const sessions = opts.sessionStore ?? new WebSessionStore();
  const resources = opts.resources ?? new ResourceSettings({ sessions, learning: opts.learning });
  let activeWrites = 0;
  let cleanupRequested = false;

  return (req, res) => {
    let path: string;
    try { path = new URL(req.url ?? '/', 'http://localhost').pathname; }
    catch { sendText(res, 400, 'invalid request URL'); return; }
    const cleanup = req.method === 'POST' && path === '/api/settings/cleanup';
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? '') && !cleanup;
    if ((write && (resources.busy || cleanupRequested)) || (cleanup && (activeWrites > 0 || cleanupRequested))) {
      sendText(res, 409, 'Codeberg is busy. Retry after current writes finish.');
      return;
    }
    if (write) activeWrites++;
    if (cleanup) cleanupRequested = true;
    let routeFinished = false;
    let responseFinished = false;
    let released = false;
    const releaseWrite = () => {
      if (!write || released || !routeFinished || !responseFinished) return;
      released = true;
      activeWrites--;
    };
    if (write) {
      const finished = () => { responseFinished = true; releaseWrite(); };
      res.once('finish', finished);
      res.once('close', finished);
    }
    const chat = req.method === 'POST' && path === CHAT_PATH;
    const id = chat ? randomUUID() : undefined;
    const started = Date.now();
    if (id) {
      writeModuleLog('agent', 'turn_started', { id });
      res.once('finish', () => {
        if (res.statusCode < 500) writeModuleLog('agent', 'turn_completed', { id, duration_ms: Date.now() - started, status: res.statusCode });
      });
      res.once('close', () => {
        if (!res.writableEnded) writeModuleLog('agent', 'turn_disconnected', { id, duration_ms: Date.now() - started });
      });
    }
    route(req, res, opts, respond, sessions, resources).catch((err: unknown) => {
      if (id) writeModuleLog('agent', 'turn_failed', { id, duration_ms: Date.now() - started, error: String(err) });
      else if (req.url?.startsWith(LEARNING_PATH)) writeModuleLog('learning-agent', 'request_failed', { error: String(err) });
      // `respond` writes the SSE headers itself, so only set a status if the
      // stream had not started yet.
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end(`internal error: ${String(err)}`);
    }).finally(() => {
      routeFinished = true;
      releaseWrite();
      if (cleanup) cleanupRequested = false;
    });
  };
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  opts: WebServerOptions,
  respond: ChatResponder,
  sessions: WebSessionStore,
  resources: ResourceSettings,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (path === '/api/settings/resources' || path === '/api/settings/cleanup') {
    try {
      res.setHeader('Cache-Control', 'no-store');
      if (path === '/api/settings/resources') {
        if (req.method !== 'GET') return sendText(res, 405, 'method not allowed');
        if (!resources.usage().current) await resources.sample();
        return sendJson(res, 200, resources.usage());
      }
      if (req.method === 'GET') {
        const days = url.searchParams.get('olderThanDays') ?? '30';
        if (!/^\d+$/.test(days)) throw new ResourceSettingsError('invalid cleanup age');
        return sendJson(res, 200, await resources.preview(Number(days)));
      }
      if (req.method !== 'POST') return sendText(res, 405, 'method not allowed');
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return sendText(res, 403, 'cross-origin cleanup is not allowed');
      if (!req.headers['content-type']?.startsWith('application/json')) return sendText(res, 415, 'application/json required');
      const body = await readJson(req);
      return sendJson(res, 200, await resources.cleanup(body));
    } catch (error) {
      if (error instanceof ResourceSettingsError) return sendText(res, error.status, error.message);
      throw error;
    }
  }

  if (req.method === 'POST' && path === CHAT_PATH) {
    return routeChat(req, res, opts.modelSettings, respond);
  }

  if (req.method === 'GET' && path === META_PATH) {
    return routeMeta(res, {
      title: opts.title,
      learningEnabled: Boolean(opts.learning),
      modelSettings: opts.modelSettings,
    });
  }

  if (path === MODELS_PATH && opts.modelSettings) {
    if (req.method === 'GET') return sendJson(res, 200, await opts.modelSettings.current());
    if (req.method === 'PUT') {
      try {
        return sendJson(res, 200, await opts.modelSettings.update(await readJson(req)));
      } catch (error) {
        if (error instanceof ModelSelectionError) return sendText(res, 400, error.message);
        throw error;
      }
    }
    return sendText(res, 405, 'method not allowed');
  }

  if (req.method === 'GET' && path === COMMANDS_PATH) {
    sendJson(res, 200, opts.commands ?? promptCommandCatalog());
    return;
  }

  if (path === SESSIONS_PATH || path.startsWith(SESSIONS_PATH + '/')) {
    await routeSessions(req, res, sessions, path, opts.learning);
    return;
  }

  if (path === CHAT_SEARCH_PATH) {
    if (req.method !== 'GET') return sendText(res, 405, 'method not allowed');
    return sendJson(res, 200, await sessions.search(url.searchParams.get('q') ?? ''));
  }

  if (opts.learning && (path === LEARNING_PATH || path.startsWith(LEARNING_PATH + '/'))) {
    await routeLearning(req, res, opts.learning, sessions, url);
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
  const sessions = opts.sessionStore ?? new WebSessionStore();
  const resources = opts.resources ?? new ResourceSettings({ sessions, learning: opts.learning });
  const server = createServer(createRequestHandler({ ...opts, sessionStore: sessions, resources }));
  server.on('listening', () => resources.start());
  server.on('close', () => resources.stop());
  return server;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
