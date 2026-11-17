import { randomUUID } from 'node:crypto';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { writeModuleLog } from '../../core/module-log.js';
import { LEARNING_PATH } from '../learning/paths.js';
import { CHAT_PATH } from './types.js';
import { HttpError } from '../../core/http-error.js';
import { sendText } from '../http.js';

export function logRequest(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): (error: unknown) => void {
  const chat = req.method === 'POST' && path === CHAT_PATH;
  const id = chat ? randomUUID() : undefined;
  const started = Date.now();
  if (id) {
    writeModuleLog('agent', 'turn_started', { id });
    res.once('finish', () => {
      if (res.statusCode < 500)
        writeModuleLog('agent', 'turn_completed', {
          id,
          duration_ms: Date.now() - started,
          status: res.statusCode,
        });
    });
    res.once('close', () => {
      if (!res.writableEnded)
        writeModuleLog('agent', 'turn_disconnected', { id, duration_ms: Date.now() - started });
    });
  }

  return (err: unknown) => {
    // A known status is a normal answer, not a server failure.
    if (err instanceof HttpError && !res.headersSent) return sendText(res, err.status, err.message);

    if (id)
      writeModuleLog('agent', 'turn_failed', {
        id,
        duration_ms: Date.now() - started,
        error: String(err),
      });
    else if (req.url?.startsWith(LEARNING_PATH))
      writeModuleLog('learning-agent', 'request_failed', { error: String(err) });

    // `respond` writes the SSE headers itself, so only set a status if the
    // stream had not started yet.
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    res.end(`internal error: ${String(err)}`);
  };
}
