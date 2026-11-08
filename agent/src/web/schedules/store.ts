import { readOptionalText, writeJsonAtomic } from '../../core/learning/fs.js';
import { WriteLock } from '../../core/write-lock.js';
import { sessionSchedulesFile } from '../sessions/layout.js';
import type { ScheduledRun } from './types.js';

/** A single owner serializes queue mutations and flushes each transition. */
export class ScheduleStore {
  private readonly lock = new WriteLock();
  private active = 0;

  constructor(readonly directory: string) {}

  get busy(): boolean {
    return this.active > 0;
  }

  async serial<T>(action: () => Promise<T>): Promise<T> {
    this.active++;
    try {
      return await this.lock.run(action);
    } finally {
      this.active--;
    }
  }

  async read(): Promise<ScheduledRun[]> {
    const json = (await readOptionalText(sessionSchedulesFile(this.directory))) ?? '[]';
    const jobs = JSON.parse(json) as ScheduledRun[];
    if (!Array.isArray(jobs)) throw new Error('Invalid scheduled run storage.');

    return jobs;
  }

  write(jobs: ScheduledRun[]): Promise<void> {
    return writeJsonAtomic(sessionSchedulesFile(this.directory), jobs);
  }
}
