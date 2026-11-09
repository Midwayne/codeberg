import type { ScheduleSummary } from '@agent/core/schedules/summary';

export function isActiveSchedule(job: ScheduleSummary): boolean {
  return ['scheduled', 'running'].includes(job.status) || Boolean(job.activeRun);
}
