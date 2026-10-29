import { defaultProviders } from '../providers/index.js';
import type { LanguageModel } from 'ai';
import { Agent } from './agent.js';
import { DaemonClient } from './client.js';
import { ContextStore, defaultContextRoot } from './context/store.js';
import type { EntryConfig } from './entry.js';
import type { LearningService } from './learning/service.js';
import { currentProjectEnvironment } from './projects.js';
import { assertAgentRuntime } from './runtime.js';
import type { ReasoningEffort } from './types.js';
import { agentProfiles } from './model-profiles.js';
import type { ModelInput } from './model-types.js';
import type { DecisionModel, DecisionUsageSink } from './decisions/types.js';

export interface AgentConfig {
  onDecisionUsage?: DecisionUsageSink;
  decisionModel?: DecisionModel | null;
  transformModel?: (model: LanguageModel) => LanguageModel;
  env?: NodeJS.ProcessEnv;
  modelSpec: string;
  modelInputs?: readonly ModelInput[];
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
  const env = config.env ?? currentProjectEnvironment();
  const registry = defaultProviders();
  const resolved = registry.resolve(config.modelSpec);
  const model = config.transformModel ? config.transformModel(resolved) : resolved;
  const learningEnabled =
    config.learning === undefined ? learningEnabledFromEnv(env) : config.learning !== false;
  const subagentSpec = config.subagentModelSpec ?? config.modelSpec;
  const subagentModel =
    subagentSpec !== config.modelSpec || (learningEnabled && !config.learning)
      ? registry.resolve(subagentSpec)
      : undefined;

  return new Agent({
    model,
    decisionModel: config.decisionModel,
    onDecisionUsage: config.onDecisionUsage,
    modelInputs: config.modelInputs,
    env,
    context: ContextStore.open(defaultContextRoot(env)),
    subagentModel,
    learning: learningEnabled ? config.learning : false,
    daemon: new DaemonClient(
      !config.env && env.CODEBERG_PROJECT_ID
        ? `${config.daemonUrl.replace(/\/$/, '')}/projects/${env.CODEBERG_PROJECT_ID}`
        : config.daemonUrl,
    ),
    reasoning: config.reasoning,
    ...agentProfiles(config.modelSpec, subagentSpec, env, config.contextWindow),
  });
}

export function learningEnabledFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return !['false', '0', 'off', 'no'].includes(
    (env.CODEBERG_LEARNING_USE ?? '').trim().toLowerCase(),
  );
}

export function createAgentFromEntry(entry: EntryConfig): Agent {
  return createAgent({
    modelSpec: entry.modelSpec,
    subagentModelSpec: entry.subagentModelSpec,
    daemonUrl: entry.daemonUrl,
    reasoning: reasoningFromEnv(),
  });
}
