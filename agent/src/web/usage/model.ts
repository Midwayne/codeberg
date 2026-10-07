import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from 'ai';
import { writeModuleLog } from '../../core/module-log.js';
import type { ModelPricing, UsageRecord } from '../../core/usage.js';
import { estimateCost } from './cost.js';
import type { UsageStore } from './store.js';

type ProviderUsage = Awaited<ReturnType<Parameters<NonNullable<LanguageModelMiddleware['wrapGenerate']>>[0]['doGenerate']>>['usage'];
export type UsageContext = Pick<UsageRecord, 'model' | 'key' | 'kind' | 'project' | 'projectName'>;

export function trackModelUsage(
  model: LanguageModel,
  store: UsageStore,
  context: UsageContext,
  pricing?: () => Promise<ModelPricing | undefined>,
): LanguageModel {
  if (typeof model === 'string') return model;

  return wrapLanguageModel({ model, middleware: {
    specificationVersion: 'v4',
    wrapGenerate: async ({ doGenerate }) => {
      const rates = await loadPricing(pricing);
      const result = await doGenerate();
      await captureUsage(store, context, result.usage, rates);

      return result;
    },
    wrapStream: async ({ doStream }) => {
      const rates = await loadPricing(pricing);
      const result = await doStream();
      let recorded = false;

      return { ...result, stream: result.stream.pipeThrough(new TransformStream({
        async transform(chunk, controller) {
          if (chunk.type === 'finish' && !recorded) {
            recorded = true;
            await captureUsage(store, context, chunk.usage, rates);
          }

          controller.enqueue(chunk);
        },
      })) };
    },
  } });
}

async function loadPricing(pricing?: () => Promise<ModelPricing | undefined>) {
  try {
    return await pricing?.();
  } catch (error) {
    writeModuleLog('agent', 'usage_pricing_failed', { error: String(error) });

    return undefined;
  }
}

export async function captureUsage(store: UsageStore, context: UsageContext, usage: ProviderUsage, rates?: ModelPricing) {
  const count = (value: number | undefined) => Number.isSafeInteger(value) && Number(value) >= 0 ? value! : null;
  const tokens = { inputTokens: count(usage.inputTokens.total), outputTokens: count(usage.outputTokens.total),
    cacheReadTokens: count(usage.inputTokens.cacheRead), cacheWriteTokens: count(usage.inputTokens.cacheWrite) };

  try {
    await store.record({ ...context, ...tokens, costUsd: estimateCost(tokens, rates) });
  } catch (error) {
    writeModuleLog('agent', 'usage_record_failed', { error: String(error) });
  }
}
