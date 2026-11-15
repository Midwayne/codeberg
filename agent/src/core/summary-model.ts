import type { LanguageModel } from 'ai';

import { fromAiSdk } from './generator.js';
import type { Generator, ReasoningEffort } from './types.js';

/** A history summarizer chosen separately from the chat model. */
export interface SummaryConfig {
  /** Provider:model name sent to the model API. */
  modelSpec: string;
  reasoning?: ReasoningEffort;
  /** Catalog window of the summarizer; inferred from the spec when unset. */
  contextWindow?: number;
  /** Wraps the resolved model, e.g. to record usage under the summary key. */
  transformModel?: (model: LanguageModel) => LanguageModel;
}

/**
 * Generator for history summaries on a dedicated model. Undefined when no
 * summarizer was chosen, so the agent keeps its default (subagent or chat
 * model).
 */
export function summaryGenerator(
  summary: SummaryConfig | undefined,
  resolve: (spec: string) => LanguageModel,
): Generator | undefined {
  if (!summary) return undefined;

  const resolved = resolve(summary.modelSpec);
  const model = summary.transformModel ? summary.transformModel(resolved) : resolved;

  return fromAiSdk(model, summary.reasoning, summary.modelSpec);
}
