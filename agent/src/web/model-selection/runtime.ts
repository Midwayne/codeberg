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

/** A loop's model, effort, and history budget are immutable for its lifetime. */
export class ModelAgentPool {
  private readonly loops = new Map<string, Promise<ToolLoopAgent>>();

  constructor(
    private readonly options: {
      build: (selection: ResolvedModelSelection) => Promise<ToolLoopAgent>;
      close?: () => Promise<void>;
    },
  ) {}

  forSelection(selection: ResolvedModelSelection): Promise<ToolLoopAgent> {
    const key = JSON.stringify(selection);
    let loop = this.loops.get(key);
    if (!loop) {
      loop = this.options.build(selection).catch((error: unknown) => {
        this.loops.delete(key);
        throw error;
      });
      this.loops.set(key, loop);
    }

    return loop;
  }

  async close(): Promise<void> {
    await this.options.close?.();
  }
}

export function createWebModelPool(
  daemonUrl: string,
  learning: LearningService | false,
  env?: NodeJS.ProcessEnv,
  transformModel?: (model: LanguageModel, selection: ResolvedModelSelection) => LanguageModel,
): ModelAgentPool {
  const agents: Array<{ close(): Promise<void> }> = [];

  return new ModelAgentPool({
    build: async (selection) => {
      const core = createAgent({
        daemonUrl,
        env,
        modelSpec: selection.model,
        reasoning: selection.effort === 'provider-default' ? undefined : selection.effort,
        contextWindow: selection.contextWindow,
        learning,
        transformModel: transformModel ? (model) => transformModel(model, selection) : undefined,
      });

      agents.push(core);
      try {
        return wrapToolLoopAgentWithCompaction(await core.toolLoopAgent(), core.historyCompactor());
      } catch (error) {
        agents.splice(agents.indexOf(core), 1);
        await core.close();
        throw error;
      }
    },
    close: async () => {
      await Promise.all(agents.map((agent) => agent.close()));
    },
  });
}

/** Picks the current learning choice at job execution time, including recovered jobs. */
export function createLearningGenerator(
  settings: Pick<ModelSettingsStore, 'current'>,
  resolveModel: (spec: string) => LanguageModel,
  transformModel?: (model: LanguageModel, key: string, spec: string) => LanguageModel,
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

      const contextWindow = selected?.contextWindow;
      const bounded = contextWindow
        ? boundLearningContext(prompt.prompt, prompt.system, contextWindow)
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

export { ReloadableAgentPool } from './reloadable.js';

export { boundLearningContext } from './learning-input.js';
