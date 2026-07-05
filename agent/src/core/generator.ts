import { generateText, type LanguageModel } from 'ai';

import type { Generator, Prompt } from './types.js';

export function fromAiSdk(model: LanguageModel): Generator {
  return {
    async generate(p: Prompt): Promise<string> {
      const { text } = await generateText({
        model,
        system: p.system,
        prompt: p.prompt,
      });
      return text;
    },
  };
}
