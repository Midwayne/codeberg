import { Agent } from './agent.js';
import { DaemonClient } from './client.js';
import { defaultProviders } from '../providers/index.js';
import { profileFor } from '../providers/profiles.js';
import type { EntryConfig } from './entry.js';
import type { ReasoningEffort } from './types.js';
import type { LearningService } from './learning/service.js';
import { assertAgentRuntime } from './runtime.js';

export interface AgentConfig {
  modelSpec: string;
  subagentModelSpec?: string;
  daemonUrl: string;
  reasoning?: ReasoningEffort;
  contextWindow?: number;
  learning?: LearningService | false;
}

const REASONING_EFFORTS: readonly ReasoningEffort[] = [
  'provider-default',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

/** Read CODEBERG_REASONING, including Responses-compatible max. */
export function reasoningFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ReasoningEffort | undefined {
  const value = env.CODEBERG_REASONING;
  return value && (REASONING_EFFORTS as string[]).includes(value)
    ? (value as ReasoningEffort)
    : undefined;
}

export function createAgent(config: AgentConfig): Agent {
  assertAgentRuntime();
  const registry = defaultProviders();
  const model = registry.resolve(config.modelSpec);
  const learningEnabled = config.learning === undefined ? learningEnabledFromEnv() : config.learning !== false;
  const subagentModel = learningEnabled && !config.learning
    ? registry.resolve(config.subagentModelSpec ?? config.modelSpec)
    : undefined;
  return new Agent({
    model,
    subagentModel,
    learning: learningEnabled ? config.learning : false,
    daemon: new DaemonClient(config.daemonUrl),
    reasoning: config.reasoning,
    // Resolve the model's memory limit + caching strategy from the same spec so
    // the agent budgets context and marks the cache prefix correctly.
    profile: config.contextWindow
      ? { ...profileFor(config.modelSpec), contextWindow: config.contextWindow }
      : profileFor(config.modelSpec),
  });
}

export function learningEnabledFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return !['false', '0', 'off', 'no'].includes((env.CODEBERG_LEARNING_USE ?? '').trim().toLowerCase());
}

export function createAgentFromEntry(entry: EntryConfig): Agent {
  return createAgent({
    modelSpec: entry.modelSpec,
    subagentModelSpec: entry.subagentModelSpec,
    daemonUrl: entry.daemonUrl,
    reasoning: reasoningFromEnv(),
  });
}
