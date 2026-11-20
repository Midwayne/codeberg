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
