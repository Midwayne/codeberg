import type { ScheduleStatus } from '../../core/schedules/summary.js';
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
  status: ScheduleStatus;
  occurrence: number;
  createdAt: number;
  lastRunId?: string;
  error?: string;
}

export function requestId(job: ScheduledRun): string {
  return `${job.id}-${job.occurrence}`;
}
