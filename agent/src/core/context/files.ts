import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ContextStore } from './store.js';

export const MAX_GREP_FILES = 2_000;
export const MAX_WALK_DEPTH = 8;
export const SKIP_DIRS = new Set(['node_modules', '.git']);

export async function collectFiles(store: ContextStore, requested: string, signal?: AbortSignal): Promise<string[]> {
  signal?.throwIfAborted();
  const real = store.resolve(requested);
  if (!real) return [];

  const info = await stat(real);
  signal?.throwIfAborted();
  if (info.isFile()) return [real];

  if (!info.isDirectory()) return [];

  const out: string[] = [];
  await walkFiles(store, real, 0, out, signal);

  return out;
}

async function walkFiles(
  store: ContextStore,
  dir: string,
  depth: number,
  out: string[],
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (depth > MAX_WALK_DEPTH || out.length >= MAX_GREP_FILES) return;

  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    signal?.throwIfAborted();
    if (out.length >= MAX_GREP_FILES) return;

    if (SKIP_DIRS.has(entry.name)) continue;

    const child = store.resolve(join(dir, entry.name));
    if (!child) continue;

    if (entry.isDirectory()) {
      await walkFiles(store, child, depth + 1, out, signal);
    } else if (entry.isFile()) {
      out.push(child);
    }
  }
}
