import { supportsMaxEffort } from '../providers/catalog.js';
import type { ReasoningEffort } from './types.js';

/** AI SDK's standardized reasoning union stops at xhigh. Responses gateways
 *  accept additional effort strings through the OpenAI provider option. */
export function maxReasoningProviderOptions(provider: string): {
  openai: { reasoningEffort: 'max' };
} {
  if (!supportsMaxEffort(provider)) {
    throw new Error('max effort requires an OpenAI Responses provider (openai or thinktank)');
  }

  return { openai: { reasoningEffort: 'max' } };
}

export interface ReasoningCallSettings {
  reasoning?: Exclude<ReasoningEffort, 'max'>;
  providerOptions?: ReturnType<typeof maxReasoningProviderOptions>;
}

/** Call settings for an effort: the standard `reasoning` field, or the
 *  provider option that carries `max`. */
export function reasoningCallSettings(effort: ReasoningEffort | undefined, provider: string): ReasoningCallSettings {
  if (effort === undefined) return {};
  if (effort === 'max') return { providerOptions: maxReasoningProviderOptions(provider) };

  return { reasoning: effort };
}
