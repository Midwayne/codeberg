import { Worker } from 'node:worker_threads';
import type { ResourceSample } from '../../core/api/resources.js';
import { isLoopbackHost } from '../http.js';
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
        if (isLoopbackHost(url.hostname)) this.endpoint = url;
      } catch {
        /* Ancillary monitoring must not break the chat server. */
      }
    }
  }
}
