import { randomUUID } from 'node:crypto';
import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

import type { ContextStore } from '../context/store.js';

const PREVIEW_HEAD_CHARS = 1_000;
const PREVIEW_TAIL_CHARS = 2_000;

/** Where a script's printed output goes while it runs. */
export interface OutputSink {
  push(chunk: string, source?: Readable): void;
  /** Flush and report what was collected. */
  close(): Promise<SinkResult>;
}

export type SinkResult =
  | { kind: 'inline'; output: string }
  | { kind: 'file'; path: string; bytes: number; preview: string };

/** Keeps everything in memory; large output is spilled after the run. */
export class MemorySink implements OutputSink {
  private readonly chunks: string[] = [];

  push(chunk: string): void {
    this.chunks.push(chunk);
  }

  async close(): Promise<SinkResult> {
    return { kind: 'inline', output: this.chunks.join('') };
  }
}

/**
 * Streams output to a file as it arrives, holding only a head and tail for
 * the preview, so output size is bounded by disk rather than memory.
 */
export class FileSink implements OutputSink {
  private readonly stream: WriteStream;
  private readonly opened: Promise<void>;
  private head = '';
  private tail = '';
  private chars = 0;
  private bytes = 0;

  private constructor(readonly path: string) {
    this.stream = createWriteStream(path, { encoding: 'utf8', flags: 'wx' });
    this.opened = new Promise((resolve, reject) => {
      this.stream.once('open', () => resolve());
      this.stream.once('error', reject);
    });
  }

  /** A new, uniquely named file under `<context>/scripts/`. */
  static async create(store: ContextStore): Promise<FileSink> {
    const dir = join(store.root, 'scripts');
    await mkdir(dir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sink = new FileSink(join(dir, `run_script-${stamp}-${randomUUID().slice(0, 8)}.txt`));
    await sink.opened;

    return sink;
  }

  push(chunk: string, source?: Readable): void {
    this.chars += chunk.length;
    this.bytes += Buffer.byteLength(chunk);

    if (this.head.length < PREVIEW_HEAD_CHARS) this.head += chunk.slice(0, PREVIEW_HEAD_CHARS - this.head.length);
    this.tail = (this.tail + chunk).slice(-PREVIEW_TAIL_CHARS);

    // Pause a fast writer until the disk catches up.
    if (!this.stream.write(chunk) && source) {
      source.pause();
      this.stream.once('drain', () => source.resume());
    }
  }

  async close(): Promise<SinkResult> {
    await new Promise<void>((resolve, reject) => {
      this.stream.once('error', reject);
      this.stream.end(() => resolve());
    });

    return { kind: 'file', path: this.path, bytes: this.bytes, preview: this.preview() };
  }

  /** The whole output when it fits in head + tail, else both ends. */
  private preview(): string {
    if (this.chars <= PREVIEW_HEAD_CHARS) return this.head;

    const rest = this.chars - this.head.length;
    if (rest <= PREVIEW_TAIL_CHARS) return this.head + this.tail.slice(-rest);

    const omitted = rest - PREVIEW_TAIL_CHARS;

    return `${this.head}\n… [${omitted} chars omitted; the full output is in the file] …\n${this.tail}`;
  }
}
