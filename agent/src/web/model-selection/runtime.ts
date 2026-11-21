import type { LanguageModel, ToolLoopAgent } from 'ai';
import { boundLearningContext } from './learning-input.js';

import { wrapToolLoopAgentWithCompaction } from '../../core/compaction.js';
import { createAgent } from '../../core/config.js';
import { fromAiSdk } from '../../core/generator.js';
import type { LearningService } from '../../core/learning/service.js';
import { writeLearningTrace } from '../../core/module-log.js';
import type { Generator } from '../../core/types.js';
import type { ResolvedModelSelection } from '../chat-routes.js';
import type { ModelSettingsStore } from './settings.js';
import type { DecisionUsageSink } from '../../core/decisions/types.js';
import { budgetWindow, profileFor } from '../../providers/profiles.js';
import { summaryConfig } from './summary.js';
import { subagentConfig } from './subagents.js';
import { ModelAgentPool } from './model-pool.js';

export { ModelAgentPool } from './model-pool.js';

export function createWebModelPool(
  daemonUrl: string,
  learning: LearningService | false,
  env?: NodeJS.ProcessEnv,
  transformModel?: (model: LanguageModel, selection: ResolvedModelSelection) => LanguageModel,
  onDecisionUsage?: DecisionUsageSink,
): ModelAgentPool {
  const deps: AgentDeps = { daemonUrl, learning, env, transformModel, onDecisionUsage };
  const agents = new Set<Closeable>();
  const owners = new Map<ToolLoopAgent, Closeable>();

  return new ModelAgentPool({
    build: async (selection) => {
      const core = selectionAgent(selection, deps);
      agents.add(core);

      try {
        const loop = wrapToolLoopAgentWithCompaction(await core.toolLoopAgent(), core.historyCompactor());
        owners.set(loop, core);

        return loop;
      } catch (error) {
        agents.delete(core);
        await core.close();
        throw error;
      }
    },
    closeLoop: async (loop) => {
      const core = owners.get(loop);
      if (!core) return;

      owners.delete(loop);
      agents.delete(core);
      await core.close();
    },
    close: async () => {
      await Promise.all([...agents].map((agent) => agent.close()));
    },
  });
}

type Closeable = { close(): Promise<void> };

interface AgentDeps {
  daemonUrl: string;
  learning: LearningService | false;
  env?: NodeJS.ProcessEnv;
  transformModel?: (model: LanguageModel, selection: ResolvedModelSelection) => LanguageModel;
  onDecisionUsage?: DecisionUsageSink;
}

/** One agent for a chat selection: its models, effort, window, summarizer, and subagents. */
function selectionAgent(selection: ResolvedModelSelection, deps: AgentDeps) {
  const { transformModel } = deps;

  return createAgent({
    daemonUrl: deps.daemonUrl,
    env: deps.env,
    modelSpec: selection.model,
    decisionModel: selection.decisionModel,
    onDecisionUsage: deps.onDecisionUsage,
    modelInputs: selection.inputs,
    reasoning: selection.effort === 'provider-default' ? undefined : selection.effort,
    contextWindow: selection.contextWindow,
    overrides: selection.overrides,
    summary: summaryConfig(selection, transformModel),
    subagents: subagentConfig(selection, transformModel),
    learning: deps.learning,
    transformModel: transformModel ? (model) => transformModel(model, selection) : undefined,
  });
}

/** Picks the current learning choice at job execution time, including recovered jobs. */
export function createLearningGenerator(
  settings: Pick<ModelSettingsStore, 'current'>,
  resolveModel: (spec: string) => LanguageModel,
  transformModel?: (model: LanguageModel, key: string, spec: string) => LanguageModel,
  env: NodeJS.ProcessEnv = process.env,
): Generator {
  const models = new Map<string, LanguageModel>();

  return {
    generate: async (prompt) => {
      const { learning, models: catalog } = await settings.current();
      const selected = catalog?.find((entry) => entry.key === learning.key);
      const modelSpec = selected?.model ?? learning.key;
      let model = models.get(modelSpec);
      if (!model) {
        model = resolveModel(modelSpec);
        models.set(modelSpec, model);
      }

      const window = learningWindow(modelSpec, selected?.contextWindow, env);
      const bounded = window
        ? boundLearningContext(prompt.prompt, prompt.system, window)
        : prompt.prompt;
      writeLearningTrace('model_request', {
        job_id: prompt.traceId,
        model: modelSpec,
        effort: learning.effort,
        system: prompt.system,
        prompt: bounded,
      });

      const tracked = transformModel ? transformModel(model, learning.key, modelSpec) : model;

      return fromAiSdk(tracked, learning.effort, modelSpec).generate({
        ...prompt,
        prompt: bounded,
      });
    },
  };
}

/**
 * Background learning shares the chat path's working window: a 1M-token model
 * must not be sent a half-window prompt (long-context premium included) for
 * one extraction. CODEBERG_CONTEXT_BUDGET raises the ceiling for both.
 */
function learningWindow(
  modelSpec: string,
  contextWindow: number | undefined,
  env: NodeJS.ProcessEnv,
): number | undefined {
  if (!contextWindow) return undefined;

  return budgetWindow({ ...profileFor(modelSpec, env), contextWindow });
}

export { ReloadableAgentPool } from './reloadable.js';

export { boundLearningContext } from './learning-input.js';
