import { join } from 'node:path';

export const SESSION_RUNS = '.runs';
export const SESSION_JOBS = '.jobs';
export const SESSION_SCHEDULES = '.schedules';
export const SCHEDULE_QUEUE_FILE = 'queue.json';

export function sessionRunsDir(directory: string, ...rest: string[]): string {
  return join(directory, SESSION_RUNS, ...rest);
}

export function sessionJobsDir(directory: string, ...rest: string[]): string {
  return join(directory, SESSION_JOBS, ...rest);
}

export function sessionSchedulesFile(directory: string, file = SCHEDULE_QUEUE_FILE): string {
  return join(directory, SESSION_SCHEDULES, file);
}
