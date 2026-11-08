import { join } from 'node:path';

const ON = new Set(['1', 'true', 'on', 'yes']);
const OFF = new Set(['0', 'false', 'off', 'no']);

/**
 * The one boolean vocabulary for `CODEBERG_*` switches: `1/true/on/yes` and
 * `0/false/off/no`, case-insensitive and trimmed. Unset, blank, or any other
 * value means `fallback`, so a typo never flips a switch away from its default.
 */
export function envFlag<T extends boolean | undefined>(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: T,
): boolean | T {
  const value = (env[name] ?? '').trim().toLowerCase();

  if (ON.has(value)) return true;

  if (OFF.has(value)) return false;

  return fallback;
}

/** Expand a leading `~` or `~/` in a user-supplied path. */
export function expandHome(path: string, home: string): string {
  if (path === '~') return home;

  if (path.startsWith('~/')) return join(home, path.slice(2));

  return path;
}
