import { envEnabled } from '../env-flag.js';

export const DEFAULT_SCRIPT_TIMEOUT_SECONDS = 60;

export const MAX_SCRIPT_TIMEOUT_SECONDS = 300;

export const MAX_SCRIPT_TOOL_CALLS = 64;

/** Captured print/traceback output; longer output is cut and then spilled. */
export const MAX_SCRIPT_OUTPUT_CHARS = 200_000;

export interface ScriptConfig {
  /** Interpreter command or path. */
  python: string;
  maxCalls: number;
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

  return { python, maxCalls: MAX_SCRIPT_TOOL_CALLS };
}

/** Clamp a requested timeout to whole seconds in [1, MAX]. */
export function scriptTimeoutMs(seconds: unknown): number {
  const requested = typeof seconds === 'number' && Number.isFinite(seconds)
    ? Math.round(seconds)
    : DEFAULT_SCRIPT_TIMEOUT_SECONDS;

  const clamped = Math.min(MAX_SCRIPT_TIMEOUT_SECONDS, Math.max(1, requested));

  return clamped * 1000;
}
