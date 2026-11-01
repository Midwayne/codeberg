export interface BackgroundOwner {
  chatId: string;
  sourceRunId: string;
}

export interface BackgroundStart {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface BackgroundJob extends BackgroundOwner {
  id: string;
  fingerprint: string;
  tool: string;
  args: Record<string, unknown>;
  status: 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  createdAt: number;
  finishedAt?: number;
  output?: unknown;
  progress?: unknown;
  error?: string;
}

export type BackgroundSummary = Omit<BackgroundJob, 'args' | 'fingerprint' | 'output' | 'progress'>;
export type BackgroundExecute = (signal: AbortSignal) => unknown;
export type ReleaseBackground = () => Promise<void>;
export type RetainBackground = () => ReleaseBackground;

export interface BackgroundService {
  start(owner: BackgroundOwner, input: BackgroundStart, execute: BackgroundExecute, retain?: RetainBackground): Promise<BackgroundSummary>;
  get(chatId: string, id: string): Promise<BackgroundJob>;
  list(chatId: string): Promise<BackgroundSummary[]>;
  cancel(chatId: string, id: string): Promise<BackgroundJob>;
}

export function backgroundSummary(job: BackgroundJob): BackgroundSummary {
  const { args: _args, fingerprint: _fingerprint, output: _output, progress: _progress, ...summary } = job;

  return summary;
}
