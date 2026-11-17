import type { ReasoningEffort } from './types.js';

/** Providers whose OpenAI Responses API accepts `reasoningEffort: 'max'`. */
function supportsMaxEffort(provider: string): boolean {
  return provider === 'openai' || provider === 'thinktank';
}

export function assertMaxEffort(provider: string): void {
  if (!supportsMaxEffort(provider)) {
    throw new Error('max effort requires an OpenAI Responses provider (openai or thinktank)');
  }
}

/** AI SDK's standardized reasoning union stops at xhigh. Responses gateways
 *  accept additional effort strings through the OpenAI provider option. */
export function maxReasoningProviderOptions(provider: string): {
  openai: { reasoningEffort: 'max' };
} {
  assertMaxEffort(provider);

  return { openai: { reasoningEffort: 'max' } };
}

/** generateText options for an effort: max via provider options, others via `reasoning`. */
export function reasoningCallOptions(provider: string, effort: ReasoningEffort | undefined) {
  if (effort === 'max') return { providerOptions: maxReasoningProviderOptions(provider) };

  if (effort && effort !== 'provider-default') return { reasoning: effort };

  return {};
}
