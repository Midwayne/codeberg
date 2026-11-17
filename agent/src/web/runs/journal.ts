import { mkdir, open, readFile, rm, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { ifMissing, writeJsonAtomic } from '../../core/fs.js';
import type { JournalEntry, RunRecord } from './types.js';

const MAX_JOURNAL_BYTES = 32 * 1024 * 1024;

type Pending = { line: string; bytes: number; resolve: () => void; reject: (error: unknown) => void };

/**
 * Each tool start/result and stream event is flushed before being acknowledged.
 * Appends that arrive while a sync is in flight share the next write and sync
 * (group commit), so a fast token stream is not bounded by one fsync per chunk.
 */
export class RunJournal {
  private queue: Pending[] = [];
  private flushing: Promise<void> | undefined;
  private file: FileHandle | undefined;
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
  async discard(): Promise<void> {
    await this.close();
    await rm(this.directory, { recursive: true, force: true });
  }

  /** Finishes pending appends and releases the events file; a later append reopens it. */
  async close(): Promise<void> {
    await this.flushing;

    const file = this.file;
    this.file = undefined;
    await file?.close();
  }

  append(entry: JournalEntry): Promise<void> {
    const line = JSON.stringify(entry) + '\n';

    return new Promise((resolve, reject) => {
      this.queue.push({ line, bytes: Buffer.byteLength(line), resolve, reject });
      this.flushing ??= this.flush();
    });
  }

  private async flush(): Promise<void> {
    while (this.queue.length > 0) {
      const accepted = this.admit(this.queue.splice(0));
      if (accepted.length > 0) await this.commit(accepted);
    }

    this.flushing = undefined;
  }

  /** Entries past the size limit are refused in order; the rest share one write. */
  private admit(batch: Pending[]): Pending[] {
    const accepted: Pending[] = [];
    let size = this.bytes;

    for (const entry of batch) {
      if (size + entry.bytes > MAX_JOURNAL_BYTES) {
        entry.reject(new Error('Search run reached its 32 MiB journal limit. Narrow the investigation.'));
        continue;
      }

      size += entry.bytes;
      accepted.push(entry);
    }

    return accepted;
  }

  private async commit(batch: Pending[]): Promise<void> {
    try {
      this.file ??= await open(join(this.directory, 'events.jsonl'), 'a', 0o600);
      await this.file.writeFile(batch.map((entry) => entry.line).join(''));
      await this.file.sync();
    } catch (error) {
      await this.file?.close().catch(() => undefined);
      this.file = undefined;
      for (const entry of batch) entry.reject(error);

      return;
    }

    for (const entry of batch) {
      this.bytes += entry.bytes;
      entry.resolve();
    }
  }

  async read(): Promise<{ record: RunRecord; entries: JournalEntry[] } | undefined> {
    const json = await readFile(join(this.directory, 'run.json'), 'utf8').catch(ifMissing(undefined));
    if (json === undefined) return undefined;

    const text = await readFile(join(this.directory, 'events.jsonl'), 'utf8').catch(ifMissing(undefined)) ?? '';
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
