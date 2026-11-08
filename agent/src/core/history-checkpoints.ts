import type { ModelMessage } from 'ai';
import { join } from 'node:path';

import { checkpointNames, newestCheckpoint, referencedArchivesExist, rememberCheckpoint } from './checkpoint-scan.js';
import type { ContextStore } from './context/store.js';
import { type FitOptions, fitHistory } from './history.js';
import { CONVERSATION_SUMMARY_OPEN, HISTORY_FILE_OPEN } from './history-tags.js';
import { hash, prefixHashes } from './message-fingerprint.js';

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
    const key = hash(`${policy}:${options.budget}:${options.keepRecent}`);
    // Independently cancellable turns must not share a live summarizer signal.
    if (options.abortSignal) return this.run(messages, hashes, options, key);

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
    const prefix = hashes[count - 1];
    if (!prefix || count <= 0 || !fitted[0].content.includes(HISTORY_FILE_OPEN)) return fitted;

    const record: Checkpoint = { version: 1, count, hash: prefix, marker: fitted[0] as Checkpoint['marker'] };
    await rememberCheckpoint(join(directory, `${prefix}.json`), record);

    return fitted;
  }

  private async load(directory: string, hashes: string[]): Promise<Checkpoint | undefined> {
    return newestCheckpoint(directory, await checkpointNames(directory), hashes, (saved, prefix, count) => {
      if (!validCheckpoint(saved, prefix, count)) return false;

      return referencedArchivesExist((path) => this.store.resolve(path), saved.marker.content);
    });
  }
}

function validCheckpoint(record: Checkpoint, hash: string, count: number): boolean {
  return record?.version === 1 && record.hash === hash && record.count === count &&
    record.marker?.role === 'user' && typeof record.marker.content === 'string' &&
    (record.marker.content.startsWith(CONVERSATION_SUMMARY_OPEN) ||
      /^\[\d+ earlier message\(s\) omitted/.test(record.marker.content));
}
