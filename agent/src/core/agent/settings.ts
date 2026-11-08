import { randomUUID } from 'node:crypto';
import type { LanguageModel } from 'ai';
import { modelSpecOf } from '../../providers/catalog.js';
import { DEFAULT_PROFILE, type ModelProfile } from '../../providers/profiles.js';
import { DaemonClient } from '../client.js';
import { ContextStore, defaultContextRoot } from '../context/store.js';
import type { DecisionModel, DecisionUsageSink } from '../decisions/types.js';
import { fromAiSdk } from '../generator.js';
import { DEFAULT_PROMPT_HOOKS } from '../hooks/defaults.js';
import type { PromptHook } from '../hooks/types.js';
import { LearningService } from '../learning/service.js';
import { defaultLearningRoot } from '../learning/store/identity.js';
import { repositoryVersions } from '../learning/store/repositories.js';
import type { McpConfig } from '../mcp/types.js';
import { summaryProfileFor } from '../model-profiles.js';
import type { ModelInput } from '../model-types.js';
import { projectRoots } from '../paths.js';
import type { Generator, ReasoningEffort } from '../types.js';
import { webConfigFromEnv } from '../web/config.js';
import type { WebConfig } from '../web/types.js';
import { agentEvaluationRuntime } from './evaluations.js';
import type { AgentOptions } from './options.js';

/** `AgentOptions` with every default applied once, at construction. */
export interface AgentSettings {
  readonly decisionModel?: DecisionModel | null;
  readonly onDecisionUsage?: DecisionUsageSink;
  readonly browserOwner: string;
  readonly env: NodeJS.ProcessEnv;
  readonly model: LanguageModel;
  readonly modelInputs?: readonly ModelInput[];
  readonly daemon: DaemonClient;
  /** Writes history summaries, on the background model. */
  readonly generator: Generator;
  readonly reasoning?: ReasoningEffort;
  readonly profile: ModelProfile;
  readonly summaryProfile: ModelProfile;
  readonly promptHooks: readonly PromptHook[];
  readonly web: WebConfig;
  /** Unset means discover servers from `env` when the tools are built. */
  readonly mcp: McpConfig | undefined;
  readonly context: ContextStore;
  readonly learning?: LearningService;
  readonly ownsLearning: boolean;
}

export function resolveAgentSettings(opts: AgentOptions): AgentSettings {
  const env = opts.env ?? process.env;
  const profile = opts.profile ?? DEFAULT_PROFILE;
  const background = opts.subagentModel ?? opts.model;
  const summaryProfile = opts.summaryProfile ?? summaryProfileOf(opts, profile, env);
  const backgroundGenerator = () => fromAiSdk(background, backgroundEffort(opts));

  return {
    decisionModel: opts.decisionModel,
    onDecisionUsage: opts.onDecisionUsage,
    browserOwner: randomUUID(),
    env,
    model: opts.model,
    modelInputs: opts.modelInputs,
    daemon: opts.daemon,
    generator: opts.generator ?? backgroundGenerator(),
    reasoning: opts.reasoning,
    profile,
    summaryProfile,
    promptHooks: opts.promptHooks ?? DEFAULT_PROMPT_HOOKS,
    web: opts.web ?? webConfigFromEnv(env),
    mcp: opts.mcp,
    context: opts.context ?? ContextStore.open(defaultContextRoot(env)),
    learning: opts.learning === false ? undefined : (opts.learning ?? new LearningService({
      root: defaultLearningRoot(env),
      repositories: () => repositoryVersions(projectRoots(env, process.cwd())),
      generator: backgroundGenerator(),
      evaluation: agentEvaluationRuntime({
        model: opts.model, judge: background, reasoning: opts.reasoning,
        profile, judgeProfile: summaryProfile, daemon: opts.daemon,
      }),
    })),
    ownsLearning: opts.learning === undefined,
  };
}

function summaryProfileOf(opts: AgentOptions, profile: ModelProfile, env: NodeJS.ProcessEnv): ModelProfile {
  if (typeof opts.subagentModel !== 'object') return profile;

  return summaryProfileFor(modelSpecOf(opts.model), modelSpecOf(opts.subagentModel), env, profile);
}

/** The configured effort belongs to the chat model; a different background
 *  model runs at its provider default. */
function backgroundEffort(opts: AgentOptions): ReasoningEffort | undefined {
  if (!opts.subagentModel) return opts.reasoning;

  return modelSpecOf(opts.subagentModel) === modelSpecOf(opts.model) ? opts.reasoning : undefined;
}
