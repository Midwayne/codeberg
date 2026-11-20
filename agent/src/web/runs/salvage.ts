import { SUBAGENT_INTERRUPTED_OUTPUTS } from '../../core/subagents/interrupted.js';

/** Builds the result to keep for a streaming call whose run ended mid-way, from its progress so far. */
type InterruptedOutput = (progress: readonly unknown[]) => unknown;

/**
 * Streaming tools that keep partial work when a run is interrupted, by tool
 * name: run settling (including recovery after a restart, when no tool
 * definitions exist) asks this table instead of recording only an error.
 */
const INTERRUPTED_OUTPUTS: Record<string, InterruptedOutput> = { ...SUBAGENT_INTERRUPTED_OUTPUTS };

/** The result a tool keeps for an interrupted call, or undefined to record an error. */
export function interruptedOutput(name: string, progress: readonly unknown[]): unknown {
  if (progress.length === 0 || !Object.hasOwn(INTERRUPTED_OUTPUTS, name)) return undefined;

  return INTERRUPTED_OUTPUTS[name]!(progress);
}
