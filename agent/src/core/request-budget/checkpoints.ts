import type { LanguageModelV4CallOptions, LanguageModelV4Message } from '@ai-sdk/provider';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { ContextStore } from '../context/store.js';
import { writeJsonAtomic } from '../learning/fs.js';
import { hash } from './estimate.js';
import { fingerprintMessage } from '../message-fingerprint.js';

export interface RequestCheckpoint {
  count: number;
  marker: LanguageModelV4Message & { role: 'user' };
  preserveUser?: number;
}

interface SavedCheckpoint extends RequestCheckpoint {
  version: 1;
  hash: string;
}

/** Prefix records retain only a textual marker and original-message positions.
 *  Attachments and system text are reused from the verified input, never encoded
 *  into a lossy JSON reconstruction of provider-specific message data. */
export class RequestCheckpoints {
  private readonly directory: string;

  constructor(private readonly store: ContextStore, policy: string) {
    this.directory = join(store.root, 'checkpoints', `request-${hash(policy)}`);
  }

  async restore(input: LanguageModelV4CallOptions): Promise<LanguageModelV4CallOptions> {
    const files = new Set(await readdir(this.directory).catch(() => [] as string[]));
    let request = input;
    const visited = new Set<string>();

    for (let pass = 0; pass < 32; pass++) {
      const keys = prefixKeys(request.prompt);
      const saved = await this.load(keys, files);
      if (!saved || visited.has(saved.hash)) break;

      visited.add(saved.hash);
      const prefix = request.prompt.slice(0, saved.count);
      if (saved.preserveUser !== undefined && prefix[saved.preserveUser]?.role !== 'user') break;

      const system = prefix.filter((message) => message.role === 'system');
      const user = saved.preserveUser === undefined ? [] : [prefix[saved.preserveUser]!];
      request = { ...request, prompt: [...system, saved.marker, ...user, ...request.prompt.slice(saved.count)] };
    }

    return request;
  }

  async save(request: LanguageModelV4CallOptions, checkpoint: RequestCheckpoint): Promise<void> {
    const key = prefixKeys(request.prompt)[checkpoint.count - 1];
    if (!key) return;

    try {
      await writeJsonAtomic(join(this.directory, `${key}.json`), { ...checkpoint, hash: key, version: 1 });
    } catch {
      // Checkpoints are reusable derived data; persistence failure keeps the run usable.
    }
  }

  private async load(keys: string[], files: Set<string>): Promise<SavedCheckpoint | undefined> {
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index]!;
      if (!files.has(`${key}.json`)) continue;

      try {
        const saved = JSON.parse(await readFile(join(this.directory, `${key}.json`), 'utf8')) as SavedCheckpoint;
        if (!valid(saved, key, index + 1)) continue;

        const text = saved.marker.content.map((part) => part.type === 'text' ? part.text : '').join('\n');
        const archives = [...text.matchAll(/<history_file>([^<]+)<\/history_file>/g)];
        if (archives.length === 0 || archives.some((match) => !this.store.resolve(match[1]!))) continue;

        return saved;
      } catch {
        // Invalid records are cache misses; original messages are still available.
      }
    }

    return undefined;
  }
}

function valid(saved: SavedCheckpoint, key: string, count: number): boolean {
  const keep = saved?.preserveUser;

  return saved?.version === 1 && saved.hash === key && saved.count === count &&
    saved.marker?.role === 'user' && Array.isArray(saved.marker.content) &&
    saved.marker.content.every((part) => part.type === 'text') &&
    (keep === undefined || (Number.isSafeInteger(keep) && keep >= 0 && keep < count));
}

function prefixKeys(messages: LanguageModelV4Message[]): string[] {
  let previous = '';

  return messages.map((message) => {
    previous = hash(previous + fingerprintMessage(message));

    return previous;
  });
}
