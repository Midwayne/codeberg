import type { LanguageModelV4CallOptions, LanguageModelV4Message } from '@ai-sdk/provider';

import type { RequestCheckpoints } from './checkpoints.js';
import { CLEAR_TRIGGER, clearOldToolResults } from './clear.js';
import { requestLimits, type BudgetOptions } from './retry.js';
import type { RequestUsage } from './usage.js';

interface PrepareDependencies {
  checkpoints: RequestCheckpoints;
  usage: RequestUsage;
  options: BudgetOptions;
}

/**
 * Clear stale tool output and reuse saved history checkpoints, in an order
 * that keeps both stable from step to step:
 *
 * - Clearing is decided on the full prompt the SDK sent, so a restored
 *   summary that hides older messages never shrinks the cleared set.
 * - Checkpoints are looked up and saved under the original messages, so a
 *   summary written for a cleared prompt is found again on the next step.
 *
 * Returns the request to send and budget options whose `saveCheckpoint`
 * translates cleared messages back to the originals.
 */
export async function prepareRequest(
  params: LanguageModelV4CallOptions,
  { checkpoints, usage, options }: PrepareDependencies,
): Promise<{ request: LanguageModelV4CallOptions; budget: BudgetOptions }> {
  const { ceiling } = requestLimits(params, options);
  const cleared = usage.estimate(params) > ceiling * CLEAR_TRIGGER
    ? await clearOldToolResults(params, options.context)
    : params;

  const restored = await checkpoints.restore(params);
  if (cleared === params) return { request: restored, budget: options };

  const toCleared = pairMessages(params.prompt, cleared.prompt);
  const toOriginal = pairMessages(cleared.prompt, params.prompt);

  const request = { ...restored, prompt: restored.prompt.map((message) => toCleared.get(message) ?? message) };
  const budget: BudgetOptions = {
    ...options,
    saveCheckpoint: (sent, checkpoint) => checkpoints.save(
      { ...sent, prompt: sent.prompt.map((message) => toOriginal.get(message) ?? message) },
      checkpoint,
    ),
  };

  return { request, budget };
}

/** Clearing keeps message order and count, so position pairs each message with its counterpart. */
function pairMessages(
  from: readonly LanguageModelV4Message[],
  to: readonly LanguageModelV4Message[],
): Map<LanguageModelV4Message, LanguageModelV4Message> {
  return new Map(from.map((message, index) => [message, to[index]!]));
}
