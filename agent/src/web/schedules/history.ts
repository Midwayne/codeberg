import type { ScheduledRun } from './types.js';

/** Keep the latest 100 entries per chat without limiting a chain of completed sleeps. */
export function reserveSchedule(jobs: ScheduledRun[], chatId: string): ScheduledRun[] {
  const owned = jobs.filter((job) => job.chatId === chatId);
  if (owned.length < 100) return jobs;

  const terminal = owned.filter((job) => !['scheduled', 'running'].includes(job.status))
    .sort((a, b) => a.createdAt - b.createdAt);
  const remove = new Set(terminal.slice(0, owned.length - 99).map((job) => job.id));
  if (owned.length - remove.size >= 100) throw new Error('This chat has reached its 100 active schedule limit.');

  return jobs.filter((job) => !remove.has(job.id));
}
