import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Managed directory for codeberg state. Mirrors the launcher's `paths.Home`:
 * a non-empty `CODEBERG_HOME` wins verbatim (it is not trimmed); otherwise
 * `~/.codeberg`. `resolveHomedir` is injectable so callers and tests can avoid
 * the process home.
 */
export function codebergHome(
  env: NodeJS.ProcessEnv = process.env,
  resolveHomedir: () => string = homedir,
): string {
  const override = env.CODEBERG_HOME;
  if (override != null && override !== '') {
    return override;
  }
  return join(resolveHomedir(), '.codeberg');
}

/** A flag env var: blank inherits `fallback`; 0/false/off/no (any case) is off. */
export function envFlag(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === '') return fallback;
  return !/^(0|false|off|no)$/i.test(value.trim());
}

/** Expand a leading `~` or `~/` against `home`. Every other path is unchanged. */
export function expandHome(path: string, home: string): string {
  if (path === '~') return home;
  if (path.startsWith('~/')) return join(home, path.slice(2));
  return path;
}
