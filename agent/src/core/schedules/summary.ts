import type { BackgroundJob, BackgroundStatus } from '../background/types.js';

export const SCHEDULE_STATUSES = ['scheduled', 'running', 'completed', 'cancelled', 'failed'] as const;

export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export interface ScheduleSummary {
  id: string;
  kind?: 'background';
  backgroundStatus?: BackgroundJob['status'];
  backgroundJobIds?: string[];
  chatId: string;
  chatTitle: string;
  chatDeleted: boolean;
  prompt: string;
  status: ScheduleStatus;
  dueAt?: number;
  everySeconds?: number;
  afterToolCallId?: string;
  model?: string;
  createdAt: number;
  lastRunId?: string;
  error?: string;
  activeRun?: { id: string; stopping: boolean };
}

/** `POST /api/schedules/:id/cancel`. */
export interface ScheduleCancelResult {
  id: string;
  kind?: 'background';
  stopping: boolean;
}

export function backgroundScheduleStatus(status: BackgroundStatus): ScheduleStatus {
  switch (status) {
    case 'running':
    case 'cancelling':
      return 'running';
    case 'interrupted':
    case 'failed':
      return 'failed';
    case 'completed':
    case 'cancelled':
      return status;
    default: {
      const never: never = status;

      return never;
    }
  }
}
