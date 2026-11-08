import type { LanguageModelV4CallOptions, LanguageModelV4Message } from '@ai-sdk/provider';
import { join } from 'node:path';

import { checkpointNames, newestCheckpoint, referencedArchivesExist, rememberCheckpoint } from '../checkpoint-scan.js';
import type { ContextStore } from '../context/store.js';
import { hash, prefixHashes } from '../message-fingerprint.js';

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
    const files = await checkpointNames(this.directory);
    let request = input;
    const visited = new Set<string>();

    for (let pass = 0; pass < 32; pass++) {
      const keys = prefixHashes(request.prompt);
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
    const key = prefixHashes(request.prompt)[checkpoint.count - 1];
    if (!key) return;

    await rememberCheckpoint(join(this.directory, `${key}.json`), { ...checkpoint, hash: key, version: 1 });
  }

  private load(keys: string[], files: Set<string>): Promise<SavedCheckpoint | undefined> {
    return newestCheckpoint(this.directory, files, keys, (saved, key, count) => {
      if (!valid(saved, key, count)) return false;

      const text = saved.marker.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n');

      return referencedArchivesExist((path) => this.store.resolve(path), text);
    });
  }
}

function valid(saved: SavedCheckpoint, key: string, count: number): boolean {
  const keep = saved?.preserveUser;

  return saved?.version === 1 && saved.hash === key && saved.count === count &&
    saved.marker?.role === 'user' && Array.isArray(saved.marker.content) &&
    saved.marker.content.every((part) => part.type === 'text') &&
    (keep === undefined || (Number.isSafeInteger(keep) && keep >= 0 && keep < count));
}
