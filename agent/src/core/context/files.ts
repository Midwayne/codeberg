import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ContextStore } from './store.js';

export { clampInt, MAX_FILE_BYTES, MAX_READ_LINES, MAX_TAIL_LINES } from './limits.js';
export { readContext } from './read.js';
export { tailContext } from './tail.js';

export const MAX_GREP_FILES = 2_000;
export const MAX_WALK_DEPTH = 8;
export const SKIP_DIRS = new Set(['node_modules', '.git']);

export async function collectFiles(store: ContextStore, requested: string): Promise<string[]> {
  const real = store.resolve(requested);
  if (!real) return [];

  const info = await stat(real);
  if (info.isFile()) return [real];

  if (!info.isDirectory()) return [];

  const out: string[] = [];
  await walkFiles(store, real, 0, out);

  return out;
}

export async function walkFiles(
  store: ContextStore,
  dir: string,
  depth: number,
  out: string[],
): Promise<void> {
  if (depth > MAX_WALK_DEPTH || out.length >= MAX_GREP_FILES) return;

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (out.length >= MAX_GREP_FILES) return;

    if (SKIP_DIRS.has(entry.name)) continue;

    const child = store.resolve(join(dir, entry.name));
    if (!child) continue;

    if (entry.isDirectory()) {
      await walkFiles(store, child, depth + 1, out);
    } else if (entry.isFile()) {
      out.push(child);
    }
  }
}
