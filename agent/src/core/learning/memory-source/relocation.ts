import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { RepositoryVersion } from '../types.js';
import type { SourceRef } from './reading.js';

/** Bounded local symbol lookup when a cited file moved; results remain unverified until opened. */
export async function relocatedSources(
  ref: SourceRef,
  repositories: RepositoryVersion[],
): Promise<SourceRef[]> {
  const repo = repositories.find((entry) => entry.path === ref.repo);
  const symbol = ref.symbol?.split(/[.#:]/).at(-1);
  if (!repo || !symbol || symbol.length < 3) return [];

  const root = await realpath(repo.path).catch(() => undefined);
  if (!root) return [];

  const dirs = [root];
  const matches: SourceRef[] = [];
  let inspected = 0;
  while (dirs.length && inspected < 2_000 && matches.length < 5) {
    const dir = dirs.shift()!;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (inspected >= 2_000 || matches.length >= 5) break;

      if (entry.isDirectory()) {
        if (
          !entry.name.startsWith('.') &&
          !['node_modules', 'vendor', 'dist', 'build', 'third_party'].includes(entry.name)
        ) {
          dirs.push(resolve(dir, entry.name));
        }

        continue;
      }

      if (!entry.isFile() || entry.name.startsWith('.')) continue;

      inspected++;
      const path = resolve(dir, entry.name);
      if (relative(root, path) === ref.path) continue;

      if (await containsSymbol(path, symbol))
        matches.push({ repo: repo.path, path: relative(root, path), symbol: ref.symbol });
    }
  }

  return matches;
}

async function containsSymbol(path: string, symbol: string): Promise<boolean> {
  try {
    if ((await stat(path)).size > 1_000_000) return false;

    const text = await readFile(path, 'utf8');

    return !text.includes('\0') && text.includes(symbol);
  } catch {
    // Files may move while scanning; keep looking.
  }

  return false;
}
