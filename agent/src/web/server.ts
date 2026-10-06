import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { logRequest } from './server/logging.js';
import { route } from './server/routes.js';
import type { WebServerOptions } from './server/types.js';
import { RequestWriteGate } from './server/write-gate.js';

import { pipeAgentUIStreamToResponse, type ToolLoopAgent } from 'ai';

import type { ChatResponder } from './chat-routes.js';
import { sendText } from './http.js';
import { LEARNING_PATH } from './learning-routes.js';
import { ResourceSettings } from './resources.js';
import { WebSessionStore } from './sessions/store.js';
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
): (req: IncomingMessage, res: ServerResponse) => void {
  const respond: ChatResponder =
    opts.respond ??
    (async (res, messages, selection) =>
      pipeAgentUIStreamToResponse({
        response: res,
        agent:
          selection && opts.selectAgent
            ? await opts.selectAgent(selection)
            : requireAgent(opts.agent),
        uiMessages: messages,
      }));

  const sessions = opts.sessionStore ?? new WebSessionStore();
  const resources =
    opts.resources ??
    new ResourceSettings({ sessions, learning: opts.learning, daemonUrl: opts.daemonUrl });
  const writes = new RequestWriteGate(resources);

  return (req, res) => {
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
    void route(req, res, opts, respond, sessions, resources).catch(fail).finally(release);
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

function requireAgent(agent: ToolLoopAgent | undefined): ToolLoopAgent {
  if (!agent) throw new Error('Select an available chat model.');

  return agent;
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
