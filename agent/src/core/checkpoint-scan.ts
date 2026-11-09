import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { historyFilePattern } from './history-tags.js';
import { writeJsonAtomic } from './learning/fs.js';

/** Names in a checkpoint directory. Any read error is an empty cache. */
export async function checkpointNames(directory: string): Promise<Set<string>> {
  return new Set(await readdir(directory).catch(() => [] as string[]));
}

/**
 * The newest key that has a readable record accepted by `accept`.
 * A corrupt record is a cache miss and the search continues.
 */
export async function newestCheckpoint<T>(
  directory: string,
  names: Set<string>,
  keys: readonly string[],
  accept: (saved: T, key: string, count: number) => boolean,
): Promise<T | undefined> {
  for (let index = keys.length - 1; index >= 0; index--) {
    const key = keys[index];
    if (key === undefined || !names.has(`${key}.json`)) continue;

    try {
      const saved = JSON.parse(await readFile(join(directory, `${key}.json`), 'utf8')) as T;
      if (accept(saved, key, index + 1)) return saved;
    } catch {
      // Corrupt or incomplete records are cache misses.
    }
  }

  return undefined;
}

/** Every history file named in `text` exists. A summary with no archive is not reusable. */
export function referencedArchivesExist(
  resolvePath: (path: string) => string | null,
  text: string,
): boolean {
  const archives = [...text.matchAll(historyFilePattern())];

  return archives.length > 0 && archives.every((match) => Boolean(resolvePath(match[1]!)));
}

/** A checkpoint is derived data. A failed write must not fail the chat. */
export async function rememberCheckpoint(path: string, value: unknown): Promise<void> {
  try {
    await writeJsonAtomic(path, value);
  } catch {
    // A full or read-only disk leaves the compacted result in memory.
  }
}
