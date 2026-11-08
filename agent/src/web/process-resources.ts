import { sample } from './process/sampling.js';
import { ProcessMonitorState } from './process/state.js';
import type { ProcessSnapshot, ProcessUsage } from './process/types.js';

/** Interval CPU and resident memory for this Codeberg instance, not the host. */
export class ProcessMonitor {
  private readonly state: ProcessMonitorState;

  constructor(
    options: {
      pid?: number;
      launcherPid?: number;
      daemonUrl?: string;
      cores?: number;
      totalMemoryBytes?: number;
      readProcesses?: () => Promise<ProcessSnapshot[]>;
      readArguments?: (pid: number) => Promise<string>;
      embeddingModel?: string;
      embeddingBackend?: string;
      now?: () => number;
    } = {},
  ) {
    this.state = new ProcessMonitorState(options);
  }

  sample(): Promise<ProcessUsage> {
    return sample(this.state);
  }
}
