import { SUBAGENT_TOOL } from '../subagents/names.js';
import { DEFAULT_TIMEOUT, SUBAGENT_TURN_TIMEOUT } from './options.js';

type TurnTimeout = typeof DEFAULT_TIMEOUT | typeof SUBAGENT_TURN_TIMEOUT;

/**
 * Deadlines for one chat turn, from the tools it offers.
 * - Browser tasks wait without a run-wide deadline.
 * - Subagent runs get a deadline sized to their own limits.
 * - Otherwise the default 2-minute step and 5-minute run deadlines apply.
 * Whenever the 2-minute step deadline is lifted, `perCallTimeout` asks the
 * caller to bound each provider call instead, so a wedged gateway still fails fast.
 */
export function turnTimeouts(toolNames: readonly string[]): { perCallTimeout: boolean; timeout?: TurnTimeout } {
  if (toolNames.includes('browser_task')) return { perCallTimeout: true };

  if (toolNames.includes(SUBAGENT_TOOL)) return { perCallTimeout: true, timeout: SUBAGENT_TURN_TIMEOUT };

  return { perCallTimeout: false, timeout: DEFAULT_TIMEOUT };
}
