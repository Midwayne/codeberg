import { gateway, wrapLanguageModel, type LanguageModel } from 'ai';

import { preflightStream } from './stream.js';
import { type BudgetOptions, withBudgetRetry } from './retry.js';
import { RequestUsage } from './usage.js';
import { RequestCheckpoints } from './checkpoints.js';

/** The provider boundary sees system text, active tool schemas, normalized
 *  attachments and each tool step. Recovery here never replays tool execution. */
export function manageContextModel(model: LanguageModel, options: BudgetOptions) {
  if (typeof model === 'string') {
    model = (globalThis.AI_SDK_DEFAULT_PROVIDER ?? gateway).languageModel(model);
  }

  const usage = new RequestUsage();
  const checkpoints = new RequestCheckpoints(options.context,
    JSON.stringify([model.provider, model.modelId, options.profile, options.checkpointPolicy, 'v1']));
  const budget = { ...options, model, saveCheckpoint: checkpoints.save.bind(checkpoints) };

  return wrapLanguageModel({ model, middleware: {
    specificationVersion: 'v4',
    wrapGenerate: async ({ model: provider, params }) => withBudgetRetry(await checkpoints.restore(params), budget, usage, async (request) => {
      const result = await provider.doGenerate(request);
      usage.record(request, result.usage);

      return result;
    }),
    wrapStream: async ({ model: provider, params }) => withBudgetRetry(await checkpoints.restore(params), budget, usage, async (request) => {
      const result = await preflightStream(await provider.doStream(request));

      return { ...result, stream: result.stream.pipeThrough(new TransformStream({
        transform(chunk, controller) {
          if (chunk.type === 'finish') usage.record(request, chunk.usage);

          controller.enqueue(chunk);
        },
      })) };
    }),
  } });
}
