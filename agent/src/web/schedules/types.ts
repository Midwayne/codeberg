import type { ResolvedModelSelection } from '../chat-routes.js';

export interface ScheduleOwner {
  chatId: string;
  sourceRunId: string;
  selection?: ResolvedModelSelection;
}

export interface ScheduledRun extends ScheduleOwner {
  id: string;
  prompt: string;
  dueAt?: number;
  everySeconds?: number;
  afterToolCallId?: string;
  backgroundJobIds?: string[];
  status: 'scheduled' | 'running' | 'completed' | 'cancelled' | 'failed';
  occurrence: number;
  createdAt: number;
  lastRunId?: string;
  error?: string;
}

/**
 * The selection a scheduled turn runs with. Diagram applies only to the message
 * it was sent with, so later turns never inherit the canvas tools.
 */
export function scheduledSelection(selection: ResolvedModelSelection | undefined): ResolvedModelSelection | undefined {
  if (!selection?.diagrams) return selection;

  const { diagrams: _diagram, ...rest } = selection;

  return rest;
}

export function requestId(job: ScheduledRun): string {
  return `${job.id}-${job.occurrence}`;
}
