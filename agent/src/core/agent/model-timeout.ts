import { wrapLanguageModel } from 'ai';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import { DEFAULT_TIMEOUT } from './options.js';
import { ModelDeadline } from './model-deadline.js';

/** Bound provider calls without charging delegated browser work to a timer. */
export function modelTimeout(model: LanguageModelV4) {
  return wrapLanguageModel({ model, middleware: {
    specificationVersion: 'v4',
    wrapGenerate: async ({ model: provider, params }) => {
      const deadline = new ModelDeadline(params.abortSignal, DEFAULT_TIMEOUT.stepMs);

      try {
        return await deadline.wait(provider.doGenerate({ ...params, abortSignal: deadline.signal }));
      } finally {
        deadline.close();
      }
    },
    wrapStream: async ({ model: provider, params }) => {
      const deadline = new ModelDeadline(params.abortSignal, DEFAULT_TIMEOUT.stepMs, DEFAULT_TIMEOUT.chunkMs);

      try {
        const result = await deadline.wait(provider.doStream({ ...params, abortSignal: deadline.signal }));

        return { ...result, stream: deadline.stream(result.stream) };
      } catch (error) {
        deadline.close();
        throw error;
      }
    },
  } });
}
