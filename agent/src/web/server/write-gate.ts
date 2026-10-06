import { type IncomingMessage, type ServerResponse } from 'node:http';
import { sendText } from '../http.js';
import { ResourceSettings } from '../resources.js';

export class RequestWriteGate {
  private activeWrites = 0;
  private cleanupRequested = false;

  constructor(private readonly resources: ResourceSettings) {}

  acquire(req: IncomingMessage, res: ServerResponse, path: string): (() => void) | undefined {
    const cleanup = req.method === 'POST' && path === '/api/settings/cleanup';
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? '') && !cleanup;
    const busyWrite = write && (this.resources.busy || this.cleanupRequested);
    const busyCleanup = cleanup && (this.activeWrites > 0 || this.cleanupRequested);

    if (busyWrite || busyCleanup) {
      sendText(res, 409, 'Codeberg is busy. Retry after current writes finish.');

      return undefined;
    }

    if (write) this.activeWrites++;

    if (cleanup) this.cleanupRequested = true;

    const finishWrite = write ? trackWrite(res, () => this.activeWrites--) : undefined;

    return () => {
      finishWrite?.();
      if (cleanup) this.cleanupRequested = false;
    };
  }
}

/** Release a write only after both routing and streaming have finished. */
export function trackWrite(res: ServerResponse, release: () => void): () => void {
  let routeFinished = false;
  let responseFinished = false;
  let released = false;

  const releaseWrite = () => {
    if (released || !routeFinished || !responseFinished) return;

    released = true;
    release();
  };

  const finished = () => {
    responseFinished = true;
    releaseWrite();
  };

  res.once('finish', finished);
  res.once('close', finished);

  return () => {
    routeFinished = true;
    releaseWrite();
  };
}
