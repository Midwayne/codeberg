export interface ProcessSnapshot {
  pid: number;
  ppid: number;
  command: string;
  cpuMs: number;
  rssBytes: number;
  startedAt: number;
}

export interface ProcessUsage {
  cpu: { usedPercent: number | null; corePercent: number | null; cores: number };
  memory: { usedBytes: number; totalBytes: number };
  processes: { pid: number; name: string; cpuPercent: number | null; memoryBytes: number }[];
  scope:
    | 'managed-stack'
    | 'web-and-daemon'
    | 'daemon-process-tree'
    | 'web-process-tree'
    | 'web-process';
}
