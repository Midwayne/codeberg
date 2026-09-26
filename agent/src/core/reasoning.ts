/** AI SDK's standardized reasoning union stops at xhigh. Responses gateways
 *  accept additional effort strings through the OpenAI provider option. */
export function maxReasoningProviderOptions(provider: string): { openai: { reasoningEffort: 'max' } } {
  if (provider !== 'openai' && provider !== 'thinktank') {
    throw new Error('max effort requires an OpenAI Responses provider (openai or thinktank)');
  }
  return { openai: { reasoningEffort: 'max' } };
}
