import type { ModelMessage } from 'ai';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { type FitOptions, fitHistory } from './history.js';
import { writeJsonAtomic } from './learning/fs.js';
import type { ContextStore } from './context/store.js';
import { fingerprintMessage } from './message-fingerprint.js';

interface Checkpoint {
  version: 1;
  count: number;
  hash: string;
  marker: ModelMessage & { role: 'user'; content: string };
}

/** Content-addressed checkpoints are safe to share only for an identical prefix
 *  and model/summary policy, under the same project's private context root. */
export class HistoryCheckpoints {
  private readonly pending = new Map<string, Promise<ModelMessage[]>>();

  constructor(private readonly store: ContextStore) {}

  fit(messages: ModelMessage[], options: FitOptions, policy: string): Promise<ModelMessage[]> {
    const hashes = prefixHashes(messages);
    const key = digest(`${policy}:${options.budget}:${options.keepRecent}`);
    const request = `${key}:${hashes.at(-1) ?? ''}`;
    const existing = this.pending.get(request);
    if (existing) return existing;

    const operation = this.run(messages, hashes, options, key).finally(() => {
      this.pending.delete(request);
    });
    this.pending.set(request, operation);

    return operation;
  }

  private async run(messages: ModelMessage[], hashes: string[], options: FitOptions, key: string) {
    const directory = join(this.store.root, 'checkpoints', key);
    const saved = await this.load(directory, hashes);
    const restored = saved ? [saved.marker, ...messages.slice(saved.count)] : messages;
    const fitted = await fitHistory(restored, options);
    if (fitted === restored || fitted[0]?.role !== 'user' || typeof fitted[0].content !== 'string') {
      return fitted;
    }

    const removed = restored.length - fitted.length + 1;
    const count = saved ? saved.count + removed - 1 : removed;
    const hash = hashes[count - 1];
    if (!hash || count <= 0 || !fitted[0].content.includes('<history_file>')) return fitted;

    const record: Checkpoint = { version: 1, count, hash, marker: fitted[0] as Checkpoint['marker'] };
    try {
      await writeJsonAtomic(join(directory, `${hash}.json`), record);
    } catch {
      // A full/read-only disk must not prevent a successfully compacted chat.
    }

    return fitted;
  }

  private async load(directory: string, hashes: string[]): Promise<Checkpoint | undefined> {
    const files = new Set(await readdir(directory).catch(() => [] as string[]));
    for (let index = hashes.length - 1; index >= 0; index--) {
      const hash = hashes[index]!;
      if (!files.has(`${hash}.json`)) continue;

      try {
        const saved = JSON.parse(await readFile(join(directory, `${hash}.json`), 'utf8')) as Checkpoint;
        if (!validCheckpoint(saved, hash, index + 1)) continue;

        const archives = [...saved.marker.content.matchAll(/<history_file>([^<]+)<\/history_file>/g)];
        if (archives.length === 0 || archives.some((match) => !this.store.resolve(match[1]!))) continue;

        return saved;
      } catch {
        // Corrupt/incomplete records are cache misses; the original chat survives.
      }
    }

    return undefined;
  }
}

function validCheckpoint(record: Checkpoint, hash: string, count: number): boolean {
  return record?.version === 1 && record.hash === hash && record.count === count &&
    record.marker?.role === 'user' && typeof record.marker.content === 'string' &&
    (record.marker.content.startsWith('<conversation_summary>') ||
      /^\[\d+ earlier message\(s\) omitted/.test(record.marker.content));
}

function prefixHashes(messages: readonly ModelMessage[]): string[] {
  let previous = '';

  return messages.map((message) => {
    previous = digest(previous + fingerprintMessage(message));

    return previous;
  });
}

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
