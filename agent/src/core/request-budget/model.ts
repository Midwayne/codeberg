import { gateway, wrapLanguageModel, type LanguageModel } from 'ai';

import { preflightStream } from './stream.js';
import { type BudgetOptions, withBudgetRetry } from './retry.js';
import { RequestUsage } from './usage.js';
import { RequestCheckpoints } from './checkpoints.js';
import { contextReport, type SystemDescription } from './breakdown.js';
import { prepareRequest } from './prepare.js';
import { emitContextEvent, hasContextListeners } from './report.js';
import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart, LanguageModelV4Usage } from '@ai-sdk/provider';

export interface ManagedModelOptions extends BudgetOptions {
  /** Main-agent loops report each request's context; subagents and helpers leave this out. */
  describeSystem?: () => SystemDescription;
}

/** The provider boundary sees system text, active tool schemas, normalized
 *  attachments and each tool step. Recovery here never replays tool execution. */
export function manageContextModel(model: LanguageModel, options: ManagedModelOptions) {
  if (typeof model === 'string') {
    model = (globalThis.AI_SDK_DEFAULT_PROVIDER ?? gateway).languageModel(model);
  }

  const usage = new RequestUsage();
  const checkpoints = new RequestCheckpoints(options.context,
    JSON.stringify([model.provider, model.modelId, options.profile, options.checkpointPolicy, 'v1']));
  const budget = { ...options, model, saveCheckpoint: checkpoints.save.bind(checkpoints) };
  const modelName = `${model.provider}:${model.modelId}`;
  const record = (request: LanguageModelV4CallOptions, used: LanguageModelV4Usage) => {
    usage.record(request, used);
    if (!options.describeSystem || !hasContextListeners()) return;

    // Reporting only observes; a failure here must never fail the chat request.
    try {
      emitContextEvent({ type: 'request', report: contextReport(request, { ...budget, modelName }, options.describeSystem(), used) });
    } catch {
      // Drop this report.
    }
  };
  const prepare = (params: LanguageModelV4CallOptions) => prepareRequest(params, { checkpoints, usage, options: budget });

  return wrapLanguageModel({ model, middleware: {
    specificationVersion: 'v4',
    wrapGenerate: async ({ model: provider, params }) => {
      const prepared = await prepare(params);

      return withBudgetRetry(prepared.request, prepared.budget, usage, async (request) => {
        const result = await provider.doGenerate(request);
        record(request, result.usage);

        return result;
      });
    },
    wrapStream: async ({ model: provider, params }) => {
      const prepared = await prepare(params);

      return withBudgetRetry(prepared.request, prepared.budget, usage, async (request) => {
        const result = await preflightStream(await provider.doStream(request));

        return { ...result, stream: result.stream.pipeThrough(recordFinish(request, record)) };
      });
    },
  } });
}

/** Pass stream chunks through, recording usage when the step finishes. */
function recordFinish(
  request: LanguageModelV4CallOptions,
  record: (request: LanguageModelV4CallOptions, used: LanguageModelV4Usage) => void,
): TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart> {
  return new TransformStream({
    transform(chunk, controller) {
      if (chunk.type === 'finish') record(request, chunk.usage);

      controller.enqueue(chunk);
    },
  });
}
