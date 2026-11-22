import { wrapLanguageModel } from 'ai';
import type { LanguageModelV4 } from '@ai-sdk/provider';

import { modelLiveness, type ModelLiveness } from './liveness.js';
import { ModelDeadline } from './model-deadline.js';

/** Longest wait between retries of a request that timed out. */
const MAX_BACKOFF_MS = 30_000;

/**
 * Fail a provider request only when it goes quiet, and retry one that timed
 * out before responding. There is no deadline on how long a response, a
 * step, or a turn may take while output keeps arriving.
 */
export function modelTimeout(model: LanguageModelV4, liveness: ModelLiveness = modelLiveness({})) {
  return wrapLanguageModel({ model, middleware: {
    specificationVersion: 'v4',
    wrapGenerate: ({ model: provider, params }) => withRetries(liveness, params.abortSignal, async () => {
      const deadline = new ModelDeadline(params.abortSignal, liveness.requestMs);

      try {
        return await deadline.wait(provider.doGenerate({ ...params, abortSignal: deadline.signal }));
      } finally {
        deadline.close();
      }
    }),
    wrapStream: ({ model: provider, params }) => withRetries(liveness, params.abortSignal, async () => {
      const deadline = new ModelDeadline(params.abortSignal, liveness.requestMs, liveness.idleMs);

      try {
        const result = await deadline.wait(provider.doStream({ ...params, abortSignal: deadline.signal }));

        return { ...result, stream: deadline.stream(result.stream) };
      } catch (error) {
        deadline.close();
        throw error;
      }
    }),
  } });
}

/** Retries only our own timeouts before any output; a user's stop or a provider error is final. */
async function withRetries<T>(liveness: ModelLiveness, parent: AbortSignal | undefined, attempt: () => Promise<T>): Promise<T> {
  for (let tries = 0; ; tries++) {
    try {
      return await attempt();
    } catch (error) {
      if (parent?.aborted || !isTimeout(error) || tries >= liveness.retries) throw error;

      await backoff(Math.min(1_000 * 2 ** tries, MAX_BACKOFF_MS), parent);
    }
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'TimeoutError';
}

function backoff(ms: number, parent: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      reject(parent!.reason);
    };
    const timer = setTimeout(() => {
      parent?.removeEventListener('abort', stop);
      resolve();
    }, ms);

    parent?.addEventListener('abort', stop, { once: true });
  });
}
