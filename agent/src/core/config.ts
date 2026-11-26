import { defaultProviders } from '../providers/index.js';
import type { LanguageModel } from 'ai';
import { Agent, type AgentOptions } from './agent.js';
import { DaemonClient } from './client.js';
import { ContextStore, defaultContextRoot } from './context/store.js';
import type { EntryConfig } from './entry.js';
import type { LearningService } from './learning/service.js';
import { currentProjectEnvironment } from './projects.js';
import { assertAgentRuntime } from './runtime.js';
import { REASONING_EFFORTS, type ReasoningEffort } from './types.js';
import { agentProfiles } from './model-profiles.js';
import type { ModelInput } from './model-types.js';
import type { DecisionModel, DecisionUsageSink } from './decisions/types.js';
import { summaryGenerator, summaryLanguageModel, type SummaryConfig } from './summary-model.js';
import type { SubagentConfig } from './subagents/config.js';
import { profileFor, type ModelOverrides } from '../providers/profiles.js';

interface AgentConfig {
  onDecisionUsage?: DecisionUsageSink;
  decisionModel?: DecisionModel | null;
  transformModel?: (model: LanguageModel) => LanguageModel;
  env?: NodeJS.ProcessEnv;
  modelSpec: string;
  modelInputs?: readonly ModelInput[];
  subagentModelSpec?: string;
  /** Dedicated history summarizer; unset summarizes on the subagent or chat model. */
  summary?: SummaryConfig;
  /** Subagent switch and model; unset follows CODEBERG_SUBAGENTS_USE and the summary model. */
  subagents?: SubagentConfig;
  daemonUrl: string;
  reasoning?: ReasoningEffort;
  contextWindow?: number;
  /** Catalog settings for the chat model; unset fields follow the environment. */
  overrides?: ModelOverrides;
  learning?: LearningService | false;
}

/** Read CODEBERG_REASONING, including Responses-compatible max. */
export function reasoningFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ReasoningEffort | undefined {
  const value = env.CODEBERG_REASONING;

  return value && (REASONING_EFFORTS as readonly string[]).includes(value)
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

  const summarySpec = config.summary?.modelSpec ?? subagentSpec;
  const summaryModel = summaryLanguageModel(config.summary, (spec) => registry.resolve(spec));

  return new Agent({
    model,
    generator: summaryGenerator(config.summary, summaryModel),
    summaryModel,
    summaryReasoning: config.summary?.reasoning,
    subagents: subagentOptions(config.subagents, (spec) => registry.resolve(spec), env),
    decisionModel: config.decisionModel,
    onDecisionUsage: config.onDecisionUsage,
    modelInputs: config.modelInputs,
    env,
    context: ContextStore.open(defaultContextRoot(env)),
    subagentModel,
    judgeModel: env.CODEBERG_JUDGE_MODEL ? registry.resolve(env.CODEBERG_JUDGE_MODEL) : undefined,
    learning: learningEnabled ? config.learning : false,
    daemon: new DaemonClient(
      !config.env && env.CODEBERG_PROJECT_ID
        ? `${config.daemonUrl.replace(/\/$/, '')}/projects/${env.CODEBERG_PROJECT_ID}`
        : config.daemonUrl,
    ),
    reasoning: config.reasoning,
    ...agentProfiles(
      config.modelSpec,
      summarySpec,
      env,
      config.contextWindow,
      config.summary?.contextWindow,
      config.overrides,
    ),
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

function subagentOptions(
  config: SubagentConfig | undefined,
  resolve: (spec: string) => LanguageModel,
  env: NodeJS.ProcessEnv,
): AgentOptions['subagents'] {
  const chosen = config?.model;
  const model = summaryLanguageModel(chosen, resolve);
  if (!chosen || !model) return config?.enabled === undefined ? undefined : { enabled: config.enabled };

  const inferred = profileFor(chosen.modelSpec, env);
  const profile = chosen.contextWindow ? { ...inferred, contextWindow: chosen.contextWindow } : inferred;

  return { enabled: config?.enabled, model, reasoning: chosen.reasoning, profile };
}
