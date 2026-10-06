import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CanvasStore } from '../../core/canvas/store.js';
import { CanvasError } from '../../core/canvas/types.js';
import { writeModuleLog } from '../../core/module-log.js';

const connections = new Map<string, Set<ServerResponse>>();

export function closeCanvasStreams(store: CanvasStore): void {
  for (const response of connections.get(store.root) ?? []) response.end();
}

/** Poll disk so CLI writes and edits in other processes reach connected browsers too. */
export function streamCanvas(_req: IncomingMessage, res: ServerResponse, store: CanvasStore): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store',
    Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const active = connections.get(store.root) ?? new Set<ServerResponse>();
  connections.set(store.root, active);
  active.add(res);
  const publish = canvasPublisher(res, store);
  const timer = setInterval(() => void publish(), 500);
  timer.unref();
  res.once('close', () => {
    clearInterval(timer);
    active.delete(res);
    if (!active.size) connections.delete(store.root);
  });
  void publish();
}

function canvasPublisher(res: ServerResponse, store: CanvasStore): () => Promise<void> {
  let previous = '';
  let busy = false;
  return async () => {
    if (busy || res.destroyed || res.writableEnded) return;

    busy = true;
    try {
      const scene = await store.current();
      const key = `${scene.name}:${scene.revision}`;
      if (key !== previous) {
        if (!res.write(`data: ${JSON.stringify({ scene })}\n\n`)) res.end();

        previous = key;
      } else res.write(': keepalive\n\n');
    } catch (error) {
      if (error instanceof CanvasError && error.status === 404) {
        if (previous !== 'empty') res.write('data: {"scene":null}\n\n');

        previous = 'empty';
        return;
      }
      const message = error instanceof Error ? error.message : 'Canvas unavailable.';
      if (message !== previous) res.write(`data: ${JSON.stringify({ error: message })}\n\n`);

      previous = message;
      if (!(error instanceof CanvasError)) writeModuleLog('agent', 'canvas_stream_failed', { error: String(error) });
    } finally {
      busy = false;
    }
  };
}
