import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** Mirrors the launcher's Go `paths.Home`: honour CODEBERG_HOME, else ~/.codeberg. */
export function codebergHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEBERG_HOME ?? join(homedir(), '.codeberg');
}

/** Indexed-repo directories from CODEBERG_ROOTS (preferred) or CODEBERG_ROOT. */
export function indexedRootsFromEnv(env: NodeJS.ProcessEnv): string[] {
  const roots = env.CODEBERG_ROOTS;
  if (roots != null && roots.trim() !== '') {
    const out: string[] = [];
    for (const line of roots.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const tab = trimmed.indexOf('\t');
      out.push(tab >= 0 ? trimmed.slice(tab + 1).trim() : trimmed);
    }
    return out.filter(Boolean);
  }
  return splitComma(env.CODEBERG_ROOT ?? '');
}

/** Nearest ancestor of `cwd` that contains `.git`, or `cwd` itself. */
export function findGitRoot(
  cwd: string,
  exists: (path: string) => boolean = existsSync,
): string {
  let dir = resolve(cwd);
  for (;;) {
    if (exists(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(cwd);
    dir = parent;
  }
}

/**
 * Repositories this process should treat as the project: indexed roots from
 * the environment, or the git checkout of `cwd` when none are set.
 */
export function projectRoots(
  env: NodeJS.ProcessEnv,
  cwd: string,
  exists: (path: string) => boolean = existsSync,
): string[] {
  const indexed = indexedRootsFromEnv(env);
  if (indexed.length > 0) return indexed;
  return [findGitRoot(cwd, exists)];
}

function splitComma(value: string): string[] {
  const out: string[] = [];
  for (const item of value.split(',')) {
    const trimmed = item.trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}
