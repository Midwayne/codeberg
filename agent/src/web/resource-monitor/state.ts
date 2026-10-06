import { Worker } from 'node:worker_threads';
import type { ResourceSample } from '../resources.js';
import type { ResourceWorkerData } from './types.js';

export class ResourceMonitorClientState {
  started = false;

  daemonReady = false;

  peerPid?: string;

  probing?: Promise<void>;

  retry?: NodeJS.Timeout;

  worker?: Worker;

  workerId = '';

  history: ResourceSample[] = [];

  readonly endpoint?: URL;

  readonly controller = new AbortController();

  constructor(
    readonly options: ResourceWorkerData & {
      fetch?: typeof globalThis.fetch;
      createWorker?: (data: ResourceWorkerData) => Worker;
    },
  ) {
    if (options.daemonUrl) {
      try {
        const url = new URL(options.daemonUrl);
        if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) this.endpoint = url;
      } catch {
        /* Ancillary monitoring must not break the chat server. */
      }
    }
  }
}
