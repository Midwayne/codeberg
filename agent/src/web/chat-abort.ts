import type { ServerResponse } from 'node:http';

/** Stop model generation and cooperative tools when the browser closes its stream. */
export function chatAbortSignal(response: ServerResponse): AbortSignal {
  const controller = new AbortController();
  const close = () => {
    if (!response.writableEnded) controller.abort();
  };

  response.once('close', close);
  response.once('finish', () => response.removeListener('close', close));
  if (response.destroyed && !response.writableEnded) controller.abort();

  return controller.signal;
}
