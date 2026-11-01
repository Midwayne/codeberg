import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonAtomic } from '../../core/learning/fs.js';
import type { ScheduledRun } from './types.js';

/** A single owner serializes queue mutations and flushes each transition. */
export class ScheduleStore {
  private pending = Promise.resolve();
  private active = 0;

  constructor(readonly directory: string) {}

  get busy(): boolean {
    return this.active > 0;
  }

  async serial<T>(action: () => Promise<T>): Promise<T> {
    this.active++;
    const pending = this.pending.then(action);
    this.pending = pending.then(() => undefined, () => undefined);
    try {
      return await pending;
    } finally {
      this.active--;
    }
  }

  async read(): Promise<ScheduledRun[]> {
    const json = await readFile(join(this.directory, '.schedules', 'queue.json'), 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;

      return '[]';
    });
    const jobs = JSON.parse(json) as ScheduledRun[];
    if (!Array.isArray(jobs)) throw new Error('Invalid scheduled run storage.');

    return jobs;
  }

  write(jobs: ScheduledRun[]): Promise<void> {
    return writeJsonAtomic(join(this.directory, '.schedules', 'queue.json'), jobs);
  }
}
