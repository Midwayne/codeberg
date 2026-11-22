import { gateway, type LanguageModel } from 'ai';
import type { LanguageModelV4 } from '@ai-sdk/provider';

import { manageContextModel, type ManagedModelOptions } from '../request-budget/model.js';
import type { ModelLiveness } from './liveness.js';
import { modelTimeout } from './model-timeout.js';

/**
 * The chat and subagent model: context management outside, liveness inside.
 * Only the provider request is timed and retried; summarizing older history
 * to make room for it can take as long as it needs and is not repeated.
 */
export function liveContextModel(model: LanguageModel, options: ManagedModelOptions, liveness: ModelLiveness) {
  return manageContextModel(modelTimeout(resolved(model), liveness), options);
}

/** String ids resolve the way `manageContextModel` resolves them. */
function resolved(model: LanguageModel): LanguageModelV4 {
  if (typeof model !== 'string') return model as LanguageModelV4;

  return (globalThis.AI_SDK_DEFAULT_PROVIDER ?? gateway).languageModel(model) as LanguageModelV4;
}
