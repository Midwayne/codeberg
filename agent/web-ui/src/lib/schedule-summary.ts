import type { ScheduleSummary } from '@agent/core/schedules/summary';

export function isActiveSchedule(job: ScheduleSummary): boolean {
  return ['scheduled', 'running'].includes(job.status) || Boolean(job.activeRun);
}

export function chatHasActiveSchedule(jobs: ScheduleSummary[] | undefined, chatId: string): boolean {
  return Boolean(jobs?.some((job) => job.chatId === chatId && isActiveSchedule(job)));
}
