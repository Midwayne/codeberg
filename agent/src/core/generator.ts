import { generateText, type LanguageModel } from 'ai';

import type { Generator, Prompt, ReasoningEffort } from './types.js';
import { maxReasoningProviderOptions } from './reasoning.js';

export function fromAiSdk(model: LanguageModel, effort?: ReasoningEffort, modelSpec?: string): Generator {
  return {
    async generate(p: Prompt): Promise<string> {
      const { text } = await generateText({
        model,
        system: p.system,
        prompt: p.prompt,
        ...(effort === 'max'
          ? { providerOptions: maxReasoningProviderOptions(modelSpec?.split(':', 1)[0] ?? '') }
          : effort && effort !== 'provider-default' ? { reasoning: effort } : {}),
      });
      return text;
    },
  };
}
