import { mkdir, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { readOptionalText, writeJsonAtomic } from '../../core/learning/fs.js';
import { WriteLock } from '../../core/write-lock.js';
import type { JournalEntry, RunRecord } from './types.js';

const MAX_JOURNAL_BYTES = 32 * 1024 * 1024;

/** Each tool start/result and stream event is flushed before being acknowledged. */
export class RunJournal {
  private readonly lock = new WriteLock();
  private bytes = 0;

  constructor(readonly directory: string) {}

  async create(record: RunRecord): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await this.save(record);
  }

  save(record: RunRecord): Promise<void> {
    return writeJsonAtomic(join(this.directory, 'run.json'), record);
  }

  /** Only discard an admission that failed before generation could start. */
  discard(): Promise<void> {
    return rm(this.directory, { recursive: true, force: true });
  }

  append(entry: JournalEntry): Promise<void> {
    const line = JSON.stringify(entry) + '\n';
    return this.lock.run(async () => {
      if (this.bytes + Buffer.byteLength(line) > MAX_JOURNAL_BYTES) {
        throw new Error('Search run reached its 32 MiB journal limit. Narrow the investigation.');
      }

      const file = await open(join(this.directory, 'events.jsonl'), 'a', 0o600);
      try {
        await file.writeFile(line);
        await file.sync();
        this.bytes += Buffer.byteLength(line);
      } finally {
        await file.close();
      }
    });
  }

  async read(): Promise<{ record: RunRecord; entries: JournalEntry[] } | undefined> {
    const json = await readOptionalText(join(this.directory, 'run.json'));
    if (json === undefined) return undefined;

    const text = (await readOptionalText(join(this.directory, 'events.jsonl'))) ?? '';
    this.bytes = Buffer.byteLength(text);
    const lines = text.split('\n');
    // Quarantine an incomplete final write before appending recovery observations.
    const tail = lines.pop();
    if (tail) {
      const file = await open(join(this.directory, 'events.jsonl'), 'r+');
      try {
        this.bytes -= Buffer.byteLength(tail);
        await file.truncate(this.bytes);
        await file.sync();
      } finally {
        await file.close();
      }
    }

    return { record: JSON.parse(json), entries: lines.filter(Boolean).map((line) => JSON.parse(line)) };
  }
}
