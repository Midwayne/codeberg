import type { LanguageModel } from 'ai';

import type { ModelSelection, ModelSettings } from '../../core/model-types.js';
import type { SummaryConfig } from '../../core/summary-model.js';

/** The chosen history summarizer, resolved against the catalog for one request. */
export type SummaryModel = ModelSelection & { model: string; contextWindow: number };

type SummarySelection = ModelSelection & {
  model: string;
  contextWindow: number;
  summary?: SummaryModel;
};

/** Undefined while summaries follow the chat model (the default). */
export function summaryModel(
  settings: Pick<ModelSettings, 'models' | 'summary'>,
): SummaryModel | undefined {
  const chosen = settings.summary;
  if (!chosen) return undefined;

  const entry = settings.models.find((model) => model.key === chosen.key);
  if (!entry) return undefined;

  return {
    key: entry.key,
    model: entry.model,
    effort: chosen.effort,
    contextWindow: entry.contextWindow,
  };
}

/** Agent summarizer config for a chat selection; usage is recorded under the summary key. */
export function summaryConfig<S extends SummarySelection>(
  selection: S,
  transformModel?: (model: LanguageModel, selection: S) => LanguageModel,
): SummaryConfig | undefined {
  const summary = selection.summary;
  if (!summary) return undefined;

  const tracked = { ...selection, key: summary.key, model: summary.model };

  return {
    modelSpec: summary.model,
    reasoning: summary.effort,
    contextWindow: summary.contextWindow,
    transformModel: transformModel ? (model) => transformModel(model, tracked) : undefined,
  };
}
