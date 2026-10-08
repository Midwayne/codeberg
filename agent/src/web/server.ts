import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { logRequest } from './server/logging.js';
import { route } from './server/routes.js';
import type { WebServerOptions } from './server/types.js';
import { RequestWriteGate } from './server/write-gate.js';

import type { ChatResponder } from './chat-routes.js';
import { sendText } from './http.js';
import { LEARNING_PATH } from './learning-routes.js';
import { ResourceSettings } from './resources.js';
import { WebSessionStore } from './sessions/store.js';
import { sharedUsageStore } from './usage/shared.js';
import { defaultChatResponder } from './usage/respond.js';
export { LEARNING_PATH };

/** Streams an agent turn to a Node response, given the client's UI messages. */
export type { ChatResponder, ResolvedModelSelection } from './chat-routes.js';

/**
 * The request handler bridging a browser chat client to the code-search agent.
 *
 * The chat route is intentionally stateless: the client holds the conversation
 * and posts the full message array each turn, so a request maps straight onto
 * `pipeAgentUIStreamToResponse`; persistence is handled by the session routes.
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
  const writes = new RequestWriteGate(resources);

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
    await route(req, res, opts, respond, sessions, resources).catch(fail).finally(release);
  };
}

/** Builds (but does not start) the HTTP server. Call `.listen()` to run it. */
export function createWebServer(opts: WebServerOptions): Server {
  const sessions = opts.sessionStore ?? new WebSessionStore();
  const resources =
    opts.resources ??
    new ResourceSettings({ sessions, learning: opts.learning, daemonUrl: opts.daemonUrl });
  const server = createServer(createRequestHandler({ ...opts, sessionStore: sessions, resources }));
  server.on('listening', () => resources.start());
  server.on('close', () => resources.stop());

  return server;
}

export type { WebServerOptions } from './server/types.js';

export {
  CHAT_PATH,
  CHAT_SEARCH_PATH,
  COMMANDS_PATH,
  META_PATH,
  MODELS_PATH,
  SESSIONS_PATH,
} from './server/types.js';
