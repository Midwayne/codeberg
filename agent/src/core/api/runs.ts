/** Response headers set on chat and stream responses for the run being piped. */
export const RUN_ID_HEADER = 'x-codeberg-run';
export const RUN_STATUS_HEADER = 'x-codeberg-status';

export type RunStatus = 'running' | 'completed' | 'stopped' | 'failed' | 'interrupted';

/** A tool call outcome as recorded in a run journal. */
export interface ToolObservation {
  kind: 'tool';
  id: string;
  name: string;
  state: 'started' | 'completed' | 'failed';
  input?: unknown;
  output?: unknown;
  error?: string;
}

/** `GET /api/chat/:id/run`: the run's state without its event stream. */
export interface RunSummary {
  id: string;
  requestId: string;
  status: RunStatus;
  createdAt: number;
  finishedAt?: number;
  error?: string;
  messageId?: string;
  eventCount: number;
  tools: ToolObservation[];
}
