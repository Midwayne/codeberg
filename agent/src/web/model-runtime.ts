import type { LanguageModel, ToolLoopAgent } from 'ai';

import { createAgent } from '../core/config.js';
import { wrapToolLoopAgentWithCompaction } from '../core/compaction.js';
import { fromAiSdk } from '../core/generator.js';
import type { LearningService } from '../core/learning/service.js';
import type { Generator } from '../core/types.js';
import type { ModelSettingsStore } from './model-settings.js';
import type { ResolvedModelSelection } from './server.js';

/** A loop's model, effort, and history budget are immutable for its lifetime. */
export class ModelAgentPool {
  private readonly loops = new Map<string, Promise<ToolLoopAgent>>();

  constructor(private readonly options: {
    build: (selection: ResolvedModelSelection) => Promise<ToolLoopAgent>;
    close?: () => Promise<void>;
  }) {}

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

export function createWebModelPool(daemonUrl: string, learning: LearningService | false): ModelAgentPool {
  const agents: Array<{ close(): Promise<void> }> = [];
  return new ModelAgentPool({
    build: async (selection) => {
      const core = createAgent({
        daemonUrl,
        modelSpec: selection.model,
        reasoning: selection.effort === 'provider-default' ? undefined : selection.effort,
        contextWindow: selection.contextWindow,
        learning,
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
      return fromAiSdk(model, learning.effort, modelSpec).generate({
        ...prompt,
        prompt: contextWindow ? boundLearningContext(prompt.prompt, prompt.system, contextWindow) : prompt.prompt,
      });
    },
  };
}

function boundLearningContext(input: string, system: string, contextWindow: number): string {
  // Reserve roughly half the token window for output and account for system text.
  const maxChars = Math.max(512, Math.floor(contextWindow * 2) - system.length);
  if (input.length <= maxChars) return input;
  const excerpt = Math.floor(maxChars * 0.4);
  return JSON.stringify({
    truncated: true,
    opening_context: input.slice(0, excerpt),
    ending_context: input.slice(-excerpt),
  });
}
