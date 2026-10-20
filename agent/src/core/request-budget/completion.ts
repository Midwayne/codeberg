import type { AnthropicLanguageModelOptions } from '@ai-sdk/anthropic';
import { getModelCapabilities } from '@ai-sdk/anthropic/internal';
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';
import { mapReasoningToProviderBudget } from '@ai-sdk/provider-utils';

export interface ModelIdentity {
  provider: string;
  modelId: string;
}

/** Anthropic's budget-based thinking is added to maxOutputTokens during SDK
 *  serialization. Use its capability and effort helpers to reserve that total. */
export function completionTokens(request: LanguageModelV4CallOptions, model: ModelIdentity, answer: number): number {
  if (model.provider.split('.')[0] !== 'anthropic') return answer;

  const capabilities = getModelCapabilities(model.modelId);
  const options = request.providerOptions?.anthropic as AnthropicLanguageModelOptions | undefined;
  const thinking = thinkingTokens(request, options, capabilities);
  const ceiling = capabilities.isKnownModel ? capabilities.maxOutputTokens : Infinity;

  return Math.min(answer + thinking, ceiling);
}

function thinkingTokens(
  request: LanguageModelV4CallOptions,
  options: AnthropicLanguageModelOptions | undefined,
  capabilities: ReturnType<typeof getModelCapabilities>,
): number {
  if (options?.thinking != null) {
    return options.thinking.type === 'enabled' && !capabilities.rejectsThinkingDisabled
      ? options.thinking.budgetTokens ?? 1024 : 0;
  }

  const reasoning = request.reasoning;
  if (options?.effort != null || capabilities.supportsAdaptiveThinking ||
      reasoning === undefined || reasoning === 'none' || reasoning === 'provider-default') return 0;

  return mapReasoningToProviderBudget({
    reasoning,
    maxOutputTokens: capabilities.maxOutputTokens,
    maxReasoningBudget: capabilities.maxOutputTokens,
    warnings: [],
  }) ?? 0;
}
