import type { ProcessSnapshot } from './types.js';

export class ProcessMonitorState {
  previous = new Map<string, number>();

  previousAt?: number;

  names = new Map<string, string>();

  fallbackCpu?: NodeJS.CpuUsage;

  fallbackAt?: number;

  constructor(
    readonly options: {
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
  ) {}
}
