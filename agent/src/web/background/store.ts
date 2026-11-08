import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { sessionJobsDir } from '../sessions/layout.js';
import { writeJsonAtomic } from '../../core/learning/fs.js';
import type { BackgroundJob } from '../../core/background/types.js';
import { isValidSessionId } from '../../core/api/sessions.js';
import { HttpError } from '../../core/api/errors.js';

export class BackgroundError extends HttpError {}

export class BackgroundStore {
  private pending = Promise.resolve();
  private writes = 0;

  constructor(readonly directory: string) {}

  get busy(): boolean {
    return this.writes > 0;
  }

  async serial<T>(action: () => Promise<T>): Promise<T> {
    this.writes++;
    const pending = this.pending.then(action);
    this.pending = pending.then(() => undefined, () => undefined);
    try {
      return await pending;
    } finally {
      this.writes--;
    }
  }

  async read(chatId: string, id: string): Promise<BackgroundJob | undefined> {
    const path = this.path(chatId, id);
    const json = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;

      return undefined;
    });
    if (json === undefined) return;

    const job = JSON.parse(json) as BackgroundJob;
    if (job.id !== id || job.chatId !== chatId) throw new BackgroundError(500, 'Background job ownership is invalid.');

    return job;
  }

  async all(): Promise<BackgroundJob[]> {
    const root = sessionJobsDir(this.directory);
    const chats = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;

      return [];
    });
    const records: BackgroundJob[] = [];
    for (const chat of chats) {
      if (!chat.isDirectory() || !isValidSessionId(chat.name)) continue;

      for (const file of await readdir(join(root, chat.name), { withFileTypes: true })) {
        if (!file.isFile() || !/^[a-f0-9]{32}\.json$/.test(file.name)) continue;

        const job = await this.read(chat.name, file.name.slice(0, -5));
        if (job) records.push(job);
      }
    }

    return records.sort((a, b) => b.createdAt - a.createdAt);
  }

  write(job: BackgroundJob): Promise<void> {
    if (Buffer.byteLength(JSON.stringify(job)) > 32 * 1024 * 1024) throw new Error('Background job exceeds its 32 MiB record limit.');

    return writeJsonAtomic(this.path(job.chatId, job.id), job);
  }

  private path(chatId: string, id: string): string {
    if (!isValidSessionId(chatId) || !/^[a-f0-9]{32}$/.test(id)) throw new BackgroundError(400, 'Invalid background job ID.');

    return join(sessionJobsDir(this.directory, chatId), `${id}.json`);
  }
}
