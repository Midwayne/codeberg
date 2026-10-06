export const SAMPLE_MS = 10_000;

export const DISK_MS = 5 * 60_000;

export const RETENTION_MS = 60 * 60_000;

export interface ResourceReader {
  start(): void;
  stop(): void;
  read(after?: number): Promise<string> | string;
  invalidateDisk(): void;
}

export interface ResourceWorkerData {
  home: string;
  sessionsDir: string;
  learningRoot: string;
  daemonUrl?: string;
  env?: NodeJS.ProcessEnv;
}
