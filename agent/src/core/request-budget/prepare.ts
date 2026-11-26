import type { LanguageModelV4CallOptions, LanguageModelV4Message } from '@ai-sdk/provider';

import type { RequestCheckpoints } from './checkpoints.js';
import { CLEAR_TRIGGER, clearOldToolResults, CURRENT_TURN_TRIGGER } from './clear.js';
import { pruneKept } from './choices.js';
import { contextNotice, newlyCleared, SUMMARY_SOON, withNotice, type ContextLevel } from './notice.js';
import { requestLimits, type BudgetOptions } from './retry.js';
import { currentSelection, type ContextSelection } from './selection.js';
import { contextSnapshot } from './snapshot.js';
import type { RequestUsage } from './usage.js';

interface PrepareDependencies {
  checkpoints: RequestCheckpoints;
  usage: RequestUsage;
  options: BudgetOptions;
  /** The calling agent's keep/release choices; defaults to the current chat and agent. */
  selection?: ContextSelection;
}

/**
 * Clear stale tool output and reuse saved history checkpoints, in an order
 * that keeps both stable from step to step:
 *
 * - Clearing is decided on the full prompt the SDK sent, so a restored
 *   summary that hides older messages never shrinks the cleared set.
 * - Results of the turn in progress outlast earlier turns' results.
 * - Results the agent kept or released override the automatic choice.
 * - Checkpoints are looked up and saved under the original messages, so a
 *   summary written for a cleared prompt is found again on the next step.
 *
 * Returns the request to send and budget options whose `saveCheckpoint`
 * translates cleared messages back to the originals. The agent's selection
 * records what the request carried, for context_status. A usage `notice`,
 * when due, is for the caller to append after any compaction, so the
 * summarizer never mistakes it for the turn's question.
 */
export async function prepareRequest(
  params: LanguageModelV4CallOptions,
  deps: PrepareDependencies,
): Promise<PreparedRequest> {
  const selection = deps.selection ?? await currentSelection();
  const { cleared, level } = await clearedRequest(params, deps, selection);
  const prepared = await withCheckpoints(params, cleared, deps);

  return { ...prepared, finish: finisher(params, prepared.request, level, deps, selection) };
}

export interface PreparedRequest {
  request: LanguageModelV4CallOptions;
  budget: BudgetOptions;
  /** Called with the request about to be sent, after any compaction; returns it with any notice appended. */
  finish(sent: LanguageModelV4CallOptions): Promise<LanguageModelV4CallOptions>;
}

/**
 * Record what the sent request carries, for context_status, and decide the
 * usage notice once from it: a request just summarized is not warned that a
 * summary is coming. Budget retries reuse the first decision.
 */
function finisher(
  params: LanguageModelV4CallOptions,
  prepared: LanguageModelV4CallOptions,
  level: ContextLevel,
  deps: PrepareDependencies,
  selection: ContextSelection,
): PreparedRequest['finish'] {
  const { window, ceiling } = requestLimits(params, deps.options);
  let notice: string | undefined | null = null;

  return async (sent) => {
    const estimated = deps.usage.estimate(sent);
    selection.snapshot = contextSnapshot({ prompt: sent.prompt, window, ceiling, estimated, keep: selection.keep });
    if (pruneKept(selection)) await selection.save();

    if (notice === null) {
      const summarized = sent.prompt !== prepared.prompt;
      const reached: ContextLevel = !summarized && estimated > ceiling * SUMMARY_SOON ? 3 : level;
      notice = contextNotice(sent, reached, { estimated, ceiling }, selection);
    }

    return withNotice(sent, notice);
  };
}

async function withCheckpoints(
  params: LanguageModelV4CallOptions,
  cleared: LanguageModelV4CallOptions,
  { checkpoints, options }: PrepareDependencies,
): Promise<{ request: LanguageModelV4CallOptions; budget: BudgetOptions }> {
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

/**
 * Earlier turns are cleared from half the ceiling. The turn in progress is
 * cleared too only when it alone keeps the request past the higher trigger.
 * Both checks measure prompts that only grow within a turn and ignore the
 * agent's choices, so a release never brings automatically cleared results
 * back, and the cached prefix stays stable. Released results are cleared at
 * any size of request.
 */
async function clearedRequest(
  params: LanguageModelV4CallOptions,
  { usage, options }: PrepareDependencies,
  selection: ContextSelection,
): Promise<{ cleared: LanguageModelV4CallOptions; level: ContextLevel }> {
  const { ceiling } = requestLimits(params, options);
  const choice = { keep: selection.keep, release: selection.release };
  const chosen = selection.keep.size > 0 || selection.release.size > 0;

  if (usage.estimate(params) <= ceiling * CLEAR_TRIGGER) {
    const cleared = selection.release.size > 0
      ? await clearOldToolResults(params, options.context, { ...choice, earlier: false })
      : params;

    return { cleared, level: 0 };
  }

  const earlier = await clearOldToolResults(params, options.context);
  const currentTurn = usage.estimate(earlier) > ceiling * CURRENT_TURN_TRIGGER;
  const cleared = currentTurn || chosen
    ? await clearOldToolResults(params, options.context, { ...choice, currentTurn })
    : earlier;

  // Notices report what automatic clearing actually did, not just the thresholds.
  const automatic = !currentTurn ? earlier : chosen ? await clearOldToolResults(params, options.context, { currentTurn }) : cleared;
  const newly = newlyCleared(params, automatic);

  return { cleared, level: newly.current > 0 ? 2 : newly.earlier > 0 ? 1 : 0 };
}

/** Clearing keeps message order and count, so position pairs each message with its counterpart. */
function pairMessages(
  from: readonly LanguageModelV4Message[],
  to: readonly LanguageModelV4Message[],
): Map<LanguageModelV4Message, LanguageModelV4Message> {
  return new Map(from.map((message, index) => [message, to[index]!]));
}
