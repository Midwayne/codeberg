import { envEnabled } from '../env-flag.js';

export const SCRIPT_TOOL = 'run_script';

/** Script tool calls running at once. This paces a script that queues
 *  thousands of calls so it cannot flood the daemon; it caps nothing. */
export const MAX_SCRIPT_CALLS_IN_FLIGHT = 16;

export interface ScriptConfig {
  /** Interpreter command or path. */
  python: string;
}

/**
 * `run_script` is opt-in: it executes model-written Python on this machine.
 * - `CODEBERG_SCRIPT_USE=true` registers the tool.
 * - `CODEBERG_SCRIPT_PYTHON` overrides the interpreter (default `python3`,
 *   or `python` on Windows).
 */
export function scriptConfig(env: NodeJS.ProcessEnv): ScriptConfig | undefined {
  if (!envEnabled(env.CODEBERG_SCRIPT_USE)) return undefined;

  const python = env.CODEBERG_SCRIPT_PYTHON?.trim()
    || (process.platform === 'win32' ? 'python' : 'python3');

  return { python };
}

/** A timeout the agent asked for, in milliseconds; none means run until done. */
export function scriptTimeoutMs(seconds: unknown): number | undefined {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return undefined;

  return Math.max(1, Math.round(seconds)) * 1000;
}
