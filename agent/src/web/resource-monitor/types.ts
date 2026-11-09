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
