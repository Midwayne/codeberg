import { generateText, type LanguageModel } from 'ai';

import { modelSpecOf, parseModelSpec } from '../providers/catalog.js';
import { reasoningCallSettings } from './reasoning.js';
import { IncompleteSummaryError } from './context-errors.js';
import type { Generator, Prompt, ReasoningEffort } from './types.js';

/** `modelSpec` defaults to the spec the model reports. */
export function fromAiSdk(
  model: LanguageModel,
  effort?: ReasoningEffort,
  modelSpec?: string,
): Generator {
  const provider = effort === 'max' ? parseModelSpec(modelSpec ?? modelSpecOf(model)).provider : '';

  return {
    async generate(p: Prompt): Promise<string> {
      const { text, finishReason } = await generateText({
        model,
        system: p.system,
        prompt: p.prompt,
        ...(p.abortSignal ? { abortSignal: p.abortSignal } : {}),
        ...(p.requireComplete ? { timeout: { totalMs: 120_000 } } : {}),
        ...(p.maxOutputTokens !== undefined ? { maxOutputTokens: p.maxOutputTokens } : {}),
        ...reasoningCallSettings(effort, provider),
      });

      if (p.requireComplete && (!text.trim() || finishReason !== 'stop')) {
        throw new IncompleteSummaryError();
      }

      return text;
    },
  };
}
