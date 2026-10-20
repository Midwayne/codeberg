import { generateText, type LanguageModel } from 'ai';

import { maxReasoningProviderOptions } from './reasoning.js';
import { IncompleteSummaryError } from './context-errors.js';
import type { Generator, Prompt, ReasoningEffort } from './types.js';

export function fromAiSdk(
  model: LanguageModel,
  effort?: ReasoningEffort,
  modelSpec?: string,
): Generator {
  return {
    async generate(p: Prompt): Promise<string> {
      const { text, finishReason } = await generateText({
        model,
        system: p.system,
        prompt: p.prompt,
        ...(p.abortSignal ? { abortSignal: p.abortSignal } : {}),
        ...(p.requireComplete ? { timeout: { totalMs: 120_000 } } : {}),
        ...(p.maxOutputTokens !== undefined ? { maxOutputTokens: p.maxOutputTokens } : {}),
        ...(effort === 'max'
          ? { providerOptions: maxReasoningProviderOptions(modelSpec?.split(':', 1)[0] ?? '') }
          : effort && effort !== 'provider-default'
            ? { reasoning: effort }
            : {}),
      });

      if (p.requireComplete && (!text.trim() || finishReason !== 'stop')) {
        throw new IncompleteSummaryError();
      }

      return text;
    },
  };
}
