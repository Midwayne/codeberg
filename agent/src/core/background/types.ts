export interface BackgroundOwner {
  chatId: string;
  sourceRunId: string;
}

export interface BackgroundStart {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
}

export const BACKGROUND_STATUSES = [
  'running',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
] as const;

export type BackgroundStatus = (typeof BACKGROUND_STATUSES)[number];

export interface BackgroundJob extends BackgroundOwner {
  id: string;
  fingerprint: string;
  tool: string;
  args: Record<string, unknown>;
  status: BackgroundStatus;
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
