import { envFlag } from '../env-flag.js';
import type { SummaryConfig } from '../summary-model.js';

/** Subagents are on unless CODEBERG_SUBAGENTS_USE turns them off. */
export function subagentsEnabled(env: NodeJS.ProcessEnv): boolean {
  return envFlag(env.CODEBERG_SUBAGENTS_USE, true);
}

/** Subagent choices from Models: unset fields follow the environment and the summary model. */
export interface SubagentConfig {
  enabled?: boolean;
  /** A model chosen for subagents; resolved like the summary model. */
  model?: SummaryConfig;
}

/**
 * An optional cap on model steps per subagent message, like `maxTurns` in
 * other harnesses. Unset (the default), a subagent works until it answers;
 * the user's Stop ends it. A budget needs room for at least one tool step
 * and the final report.
 */
export function subagentMaxSteps(env: NodeJS.ProcessEnv): number | undefined {
  const value = env.CODEBERG_SUBAGENT_MAX_STEPS?.trim();
  if (!value || !/^\d+$/.test(value)) return undefined;

  const steps = Number(value);

  return Number.isSafeInteger(steps) && steps >= 2 ? steps : undefined;
}
