export interface ProcessSnapshot {
  pid: number;
  ppid: number;
  command: string;
  cpuMs: number;
  rssBytes: number;
  startedAt: number;
}
