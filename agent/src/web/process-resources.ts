import { sample } from './process/sampling.js';
import { ProcessMonitorState, type ProcessMonitorOptions } from './process/state.js';
import type { ProcessUsage } from './process/types.js';

/** Interval CPU and resident memory for this Codeberg instance, not the host. */
export class ProcessMonitor {
  private readonly state: ProcessMonitorState;

  constructor(options: ProcessMonitorOptions = {}) {
    this.state = new ProcessMonitorState(options);
  }

  sample(): Promise<ProcessUsage> {
    return sample(this.state);
  }
}

export type { ProcessSnapshot, ProcessUsage } from './process/types.js';

export { workerName } from './process/labels.js';

export { parseProcessSnapshot, selectProcessTree } from './process/snapshot.js';
