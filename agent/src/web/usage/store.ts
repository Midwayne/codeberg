import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { UsageRecord } from '../../core/usage.js';
import { codebergHome } from '../../core/paths.js';
import { appendDurable, ifMissing } from '../../core/fs.js';

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
      await appendDurable(join(this.directory, `${month}.jsonl`), row);
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

/** Strict: a corrupt spend record is reported, never silently dropped. */
async function readMonth(path: string): Promise<UsageRecord[]> {
  const content = await readFile(path, 'utf8').catch(ifMissing(''));

  return content.split('\n').filter(Boolean).map((line) => JSON.parse(line) as UsageRecord);
}
