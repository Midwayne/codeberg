import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** A JSON file in a directory store. `updatedAt` orders `list` newest-first. */
export interface DirectoryRecord {
  id: string;
  updatedAt: number;
}

/**
 * One JSON file per record (`<id>.json`). Missing directories and unreadable
 * files yield null / an empty list so one corrupt record cannot hide the rest.
 * Callers own the record shape; this class only owns the directory protocol
 * used by the browser session store.
 */
export class JsonDirectory<T extends DirectoryRecord> {
  constructor(private readonly dir: string) {}

  async save(record: T): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, `${record.id}.json`), JSON.stringify(record, null, 2), 'utf8');
  }

  async load(id: string): Promise<T | null> {
    try {
      const raw = await readFile(join(this.dir, `${id}.json`), 'utf8');
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  /** Every readable record, newest first. */
  async list(): Promise<T[]> {
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch {
      return [];
    }

    const records: T[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const record = await this.load(file.slice(0, -'.json'.length));
      if (record) records.push(record);
    }
    return records.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async remove(id: string): Promise<void> {
    try {
      await unlink(join(this.dir, `${id}.json`));
    } catch {
      // already gone / unreadable — nothing to do
    }
  }
}

/** User turns in a transcript, for session-list summaries. */
export function countUserTurns(messages: readonly { role: string }[]): number {
  return messages.filter((message) => message.role === 'user').length;
}
