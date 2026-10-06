import { Worker } from 'node:worker_threads';
import { start, stop } from './resource-monitor/lifecycle.js';
import { ResourceMonitorClientState } from './resource-monitor/state.js';
import { invalidateDisk, read } from './resource-monitor/transport.js';
import type { ResourceWorkerData } from './resource-monitor/types.js';

/** The chat process transports cached metrics; it never collects them itself. */
export class ResourceMonitorClient {
  private readonly state: ResourceMonitorClientState;

  constructor(
    options: ResourceWorkerData & {
      fetch?: typeof globalThis.fetch;
      createWorker?: (data: ResourceWorkerData) => Worker;
    },
  ) {
    this.state = new ResourceMonitorClientState(options);
  }

  start(): void {
    return start(this.state);
  }

  stop(): void {
    return stop(this.state);
  }

  read(after = 0): Promise<string> {
    return read(this.state, after);
  }

  invalidateDisk(): void {
    return invalidateDisk(this.state);
  }
}

export const RESOURCE_WORKER_URL = new URL('./resource-worker.js', import.meta.url);

export type { ResourceReader, ResourceWorkerData } from './resource-monitor/types.js';

export { DISK_MS, RETENTION_MS, SAMPLE_MS } from './resource-monitor/types.js';
