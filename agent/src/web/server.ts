import { SearchRuns } from './runs/manager.js';
import type { ChatGenerator } from './runs/types.js';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { logRequest } from './server/logging.js';
import { route } from './server/routes.js';
import type { ProjectServices, WebServerOptions } from './server/types.js';
import { RequestWriteGate } from './server/write-gate.js';

import { admitRequest, sendText } from './http.js';
import { ResourceSettings } from './resources.js';
import { WebSessionStore } from './sessions/store.js';
import { sharedUsageStore } from './usage/shared.js';

/**
 * The request handler bridging a browser chat client to the code-search agent.
 *
 * Search runs own their cancellation, journal, and transcript. HTTP responses
 * subscribe to them and can reconnect independently of generation.
 */
export function createRequestHandler(
  opts: WebServerOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const services = projectServices(opts);
  const { runs } = services;

  const writes = new RequestWriteGate(services.resources, () => runs.busy);
  runs.schedules.canDispatch = () => !writes.busy;
  runs.schedules.start();

  return async (req, res) => {
    let path: string;
    try {
      path = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      sendText(res, 400, 'invalid request URL');
      return;
    }

    if (!admitRequest(req, res)) return;

    const release = writes.acquire(req, res, path);
    if (!release) return;

    const fail = logRequest(req, res, path);
    await runs.initialize()
      .then(() => route(req, res, services)).catch(fail).finally(release);
  };
}

/** Builds (but does not start) the HTTP server. Call `.listen()` to run it. */
export function createWebServer(opts: WebServerOptions): Server {
  const services = projectServices(opts);
  const server = createServer(createRequestHandler(services));

  server.on('close', () => void services.runs.close());
  server.on('listening', () => services.resources.start());
  server.on('close', () => services.resources.stop());

  return server;
}

/** Fill in the services a caller did not inject; injected ones are kept as-is. */
function projectServices(opts: WebServerOptions): ProjectServices {
  const runs = opts.runs ?? new SearchRuns(opts.sessionStore ?? new WebSessionStore(),
    opts.generate ?? unavailableGenerator, { learning: opts.learning });
  const resources = opts.resources ?? new ResourceSettings({ sessions: runs.sessions, learning: opts.learning });

  return { ...opts, runs, resources, usage: opts.usage ?? sharedUsageStore() };
}

const unavailableGenerator: ChatGenerator = async () => {
  throw new Error('Select an available chat model.');
};
