import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonAtomic } from '../../core/learning/fs.js';
import type { JournalEntry, RunRecord } from './types.js';

const MAX_JOURNAL_BYTES = 32 * 1024 * 1024;

/** Each tool start/result and stream event is flushed before being acknowledged. */
export class RunJournal {
  private pending = Promise.resolve();
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
    const operation = this.pending.then(async () => {
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
    this.pending = operation.catch(() => undefined);

    return operation;
  }

  async read(): Promise<{ record: RunRecord; entries: JournalEntry[] } | undefined> {
    const json = await readFile(join(this.directory, 'run.json'), 'utf8').catch(missing);
    if (json === undefined) return undefined;

    const text = await readFile(join(this.directory, 'events.jsonl'), 'utf8').catch(missing) ?? '';
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

function missing(error: NodeJS.ErrnoException): undefined {
  if (error.code !== 'ENOENT') throw error;

  return undefined;
}
