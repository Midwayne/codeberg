import { SearchRuns } from './runs/manager.js';
import { defaultChatGenerator } from './usage/generate.js';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { logRequest } from './server/logging.js';
import { route } from './server/routes.js';
import type { WebServerOptions } from './server/types.js';
import { RequestWriteGate } from './server/write-gate.js';

import type { ChatResponder } from './chat-routes.js';
import { sendText } from './http.js';
import { ResourceSettings } from './resources.js';
import { WebSessionStore } from './sessions/store.js';
import { sharedUsageStore } from './usage/shared.js';
import { defaultChatResponder } from './usage/respond.js';

/**
 * The request handler bridging a browser chat client to the code-search agent.
 *
 * Search runs own their cancellation, journal, and transcript. HTTP responses
 * subscribe to them and can reconnect independently of generation.
 */
export function createRequestHandler(
  opts: WebServerOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const usage = opts.usage ?? sharedUsageStore();
  opts = { ...opts, usage };

  const respond: ChatResponder =
    opts.respond ?? defaultChatResponder(opts, usage);

  const sessions = opts.sessionStore ?? new WebSessionStore();
  const resources =
    opts.resources ??
    new ResourceSettings({ sessions, learning: opts.learning, daemonUrl: opts.daemonUrl });
  const runs = opts.runs ?? (opts.respond ? undefined
    : new SearchRuns(sessions, opts.generate ?? defaultChatGenerator(opts, usage), { learning: opts.learning }));
  opts = { ...opts, runs };
  const writes = new RequestWriteGate(resources, () => Boolean(runs?.busy));
  if (runs) {
    runs.schedules.canDispatch = () => !writes.busy;
    runs.schedules.start();
  }

  return async (req, res) => {
    let path: string;
    try {
      path = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      sendText(res, 400, 'invalid request URL');
      return;
    }

    const release = writes.acquire(req, res, path);
    if (!release) return;

    const fail = logRequest(req, res, path);
    await (runs?.initialize() ?? Promise.resolve())
      .then(() => route(req, res, opts, respond, sessions, resources)).catch(fail).finally(release);
  };
}

/** Builds (but does not start) the HTTP server. Call `.listen()` to run it. */
export function createWebServer(opts: WebServerOptions): Server {
  const sessions = opts.sessionStore ?? new WebSessionStore();
  const resources =
    opts.resources ??
    new ResourceSettings({ sessions, learning: opts.learning, daemonUrl: opts.daemonUrl });
  const runs = opts.runs ?? (opts.respond ? undefined : new SearchRuns(sessions,
    opts.generate ?? defaultChatGenerator(opts, opts.usage ?? sharedUsageStore()), { learning: opts.learning }));
  const server = createServer(createRequestHandler({ ...opts, runs, sessionStore: sessions, resources }));
  server.on('close', () => void runs?.close());
  server.on('listening', () => resources.start());
  server.on('close', () => resources.stop());

  return server;
}
