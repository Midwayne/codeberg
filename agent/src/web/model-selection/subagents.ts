import type { LanguageModel } from 'ai';

import type { ModelSelection, ModelSettings } from '../../core/model-types.js';
import type { SubagentConfig } from '../../core/subagents/config.js';
import { summaryModel, type SummaryModel } from './summary.js';

/** The subagent switch and chosen model, resolved against the catalog for one request. */
export interface SubagentChoice {
  enabled: boolean;
  /** Absent: subagents follow the summary model, then the chat model. */
  model?: SummaryModel;
}

type SubagentSelection = ModelSelection & { model: string; subagents?: SubagentChoice };

export function subagentChoice(settings: Pick<ModelSettings, 'models' | 'subagents'>): SubagentChoice {
  const { enabled } = settings.subagents;
  const model = enabled ? summaryModel({ models: settings.models, summary: settings.subagents.model }) : undefined;

  return model ? { enabled, model } : { enabled };
}

/** Agent subagent config for a chat selection; usage is recorded under the subagent model's key. */
export function subagentConfig<S extends SubagentSelection>(
  selection: S,
  transformModel?: (model: LanguageModel, selection: S) => LanguageModel,
): SubagentConfig {
  const choice = selection.subagents;
  if (!choice) return {};

  const chosen = choice.model;
  if (!chosen) return { enabled: choice.enabled };

  const tracked = { ...selection, key: chosen.key, model: chosen.model };

  return {
    enabled: choice.enabled,
    model: {
      modelSpec: chosen.model,
      reasoning: chosen.effort,
      contextWindow: chosen.contextWindow,
      transformModel: transformModel ? (model) => transformModel(model, tracked) : undefined,
    },
  };
}
