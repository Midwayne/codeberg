import { routeCanvas } from '../canvas/routes.js';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { promptCommandCatalog } from '../../core/hooks/index.js';
import { routeChat, routeMeta, type ChatResponder } from '../chat-routes.js';
import { readJson, sendJson, sendText } from '../http.js';
import { LEARNING_PATH, routeLearning } from '../learning-routes.js';
import { ModelSelectionError, type ModelSettingsStore } from '../model-selection/settings.js';
import { CHAT_PAGE_HTML } from '../page.js';
import { ResourceSettings } from '../resources.js';
import { routeSessions } from '../sessions/routes.js';
import { WebSessionStore } from '../sessions/store.js';
import { serveStatic } from '../static.js';
import { routeResources } from './resources.js';
import { routeUsage } from '../usage/routes.js';
import {
  CHAT_PATH,
  CHAT_SEARCH_PATH,
  COMMANDS_PATH,
  META_PATH,
  MODELS_PATH,
  SESSIONS_PATH,
  type WebServerOptions,
} from './types.js';

export async function route(
  req: IncomingMessage,
  res: ServerResponse,
  opts: WebServerOptions,
  respond: ChatResponder,
  sessions: WebSessionStore,
  resources: ResourceSettings,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (path === '/api/settings/usage' && opts.usage) {
    return routeUsage(req, res, opts.usage, url);
  }

  if (path === '/api/settings/resources' || path === '/api/settings/cleanup') {
    return routeResources(req, res, resources, url);
  }

  if ((path.startsWith('/api/canvas/') || path === '/api/settings/canvas') && opts.canvas) {
    return routeCanvas(req, res, opts.canvas, url);
  }

  if (path === MODELS_PATH && opts.modelSettings) return routeModels(req, res, opts.modelSettings);

  if (path.startsWith('/api/')) {
    return routeApi(req, res, opts, respond, sessions, url);
  }

  return servePage(req, res, opts, path);
}

export async function routeApi(
  req: IncomingMessage,
  res: ServerResponse,
  opts: WebServerOptions,
  respond: ChatResponder,
  sessions: WebSessionStore,
  url: URL,
): Promise<void> {
  const path = url.pathname;

  if (req.method === 'POST' && path === CHAT_PATH) {
    return routeChat(req, res, opts.modelSettings, respond);
  }

  if (req.method === 'GET' && path === META_PATH) {
    return routeMeta(res, {
      title: opts.title,
      learningEnabled: Boolean(
        opts.learning?.settings.enabled &&
          opts.learning.settings.history &&
          opts.learning.settings.historyCapture,
      ),
      modelSettings: opts.modelSettings,
    });
  }

  if (req.method === 'GET' && path === COMMANDS_PATH) {
    sendJson(res, 200, opts.commands ?? promptCommandCatalog());
    return;
  }

  if (path === SESSIONS_PATH || path.startsWith(SESSIONS_PATH + '/')) {
    await routeSessions(req, res, sessions, path, opts.learning, opts.canvas);
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

  return sendText(res, 404, 'not found');
}

export async function routeModels(
  req: IncomingMessage,
  res: ServerResponse,
  settings: ModelSettingsStore,
): Promise<void> {
  if (req.method === 'GET') return sendJson(res, 200, await settings.current());

  if (req.method === 'PUT') {
    try {
      return sendJson(res, 200, await settings.update(await readJson(req)));
    } catch (error) {
      if (error instanceof ModelSelectionError) return sendText(res, 400, error.message);

      throw error;
    }
  }

  return sendText(res, 405, 'method not allowed');
}

export async function servePage(
  req: IncomingMessage,
  res: ServerResponse,
  opts: WebServerOptions,
  path: string,
): Promise<void> {
  if (req.method === 'GET') {
    if (path === '/canvas') res.setHeader('Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'self'; object-src 'none'");

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

export function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
