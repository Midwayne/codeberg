import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { pipeAgentUIStreamToResponse, type ToolLoopAgent } from 'ai';

import { promptCommandCatalog, type PromptCommand } from '../core/hooks/index.js';
import { CHAT_PAGE_HTML } from './page.js';
import { readJson, sendJson, sendText } from './http.js';
import { routeSessions } from './session-routes.js';
import { serveStatic } from './static.js';
import { WebSessionStore } from './sessions.js';
import { LEARNING_PATH, routeLearning } from './learning-routes.js';
import type { LearningService } from '../core/learning/service.js';
import { ModelSelectionError, type ModelSelection, type ModelSettingsStore } from './model-settings.js';
import { formatWebTitle } from './title.js';

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
export type ResolvedModelSelection = ModelSelection & { model: string; contextWindow: number };
export type ChatResponder = (
  res: ServerResponse, messages: unknown[], selected?: ResolvedModelSelection,
) => Promise<void>;

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
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (req.method === 'POST' && path === CHAT_PATH) {
    const body = await readJson(req);
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const settings = await opts.modelSettings?.current();
    const selected = settings?.models.find((entry) => entry.key === settings.chat.key);
    await respond(res, messages, selected && settings ? {
      ...settings.chat, model: selected.model, contextWindow: selected.contextWindow,
    } : undefined);
    return;
  }

  if (req.method === 'GET' && path === META_PATH) {
    const settings = await opts.modelSettings?.current();
    const selected = settings?.models.find((entry) => entry.key === settings.chat.key);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      title: settings && selected
        ? `${formatWebTitle(selected.model, settings.chat.effort)}${selected.key !== selected.model ? ` · ${selected.key.slice(selected.provider.length + 1)}` : ''}`
        : opts.title,
      capabilities: { learning: Boolean(opts.learning) },
    }));
    return;
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
  return createServer(createRequestHandler(opts));
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
