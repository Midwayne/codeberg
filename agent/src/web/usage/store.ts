import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { UsageRecord } from '../../core/usage.js';
import { codebergHome } from '../../core/paths.js';

/** Separate from saved chats: cleanup and branching cannot erase or duplicate spend. */
export class UsageStore {
  private writing: Promise<void> = Promise.resolve();
  failedWrites = 0;

  constructor(readonly directory = join(codebergHome(), 'usage')) {}

  async record(input: Omit<UsageRecord, 'id' | 'timestamp'> & { timestamp?: number }): Promise<void> {
    const row: UsageRecord = { ...input, id: randomUUID(), timestamp: input.timestamp ?? Date.now() };
    const month = new Date(row.timestamp).toISOString().slice(0, 7);
    const writing = this.writing.then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await appendFile(join(this.directory, `${month}.jsonl`), JSON.stringify(row) + '\n', { mode: 0o600 });
    });

    this.writing = writing.catch(() => undefined);
    try {
      await writing;
    } catch (error) {
      this.failedWrites++;

      throw error;
    }
  }

  async read(start: string, end: string): Promise<UsageRecord[]> {
    await this.writing;
    const from = Date.parse(start);
    const until = Date.parse(end);
    const rows: UsageRecord[] = [];
    const month = new Date(from);
    month.setUTCDate(1);

    while (month.getTime() < until) {
      const path = join(this.directory, `${month.toISOString().slice(0, 7)}.jsonl`);
      rows.push(...await readMonth(path));
      month.setUTCMonth(month.getUTCMonth() + 1);
    }

    return rows.filter((row) => row.timestamp >= from && row.timestamp < until)
      .sort((a, b) => b.timestamp - a.timestamp);
  }
}

async function readMonth(path: string): Promise<UsageRecord[]> {
  try {
    const content = await readFile(path, 'utf8');

    return content.split('\n').filter(Boolean).map((line) => JSON.parse(line) as UsageRecord);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];

    throw error;
  }
}
