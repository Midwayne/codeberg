import type { ModelMessage, ToolLoopAgent } from "ai";

import { withMessageTransforms } from "./loop.js";

/** Compacts a transcript to the model's history budget (summarizing the
 *  overflow). Same shape as `Agent.historyCompactor()`. */
export type HistoryCompactor = (
  messages: ModelMessage[],
) => Promise<ModelMessage[]>;

/**
 * Wrap a `ToolLoopAgent` so each call's transcript is compacted to the model's
 * history budget before it is sent — the policy `Agent.ask` applies on the CLI,
 * made available to callers that drive the loop directly (the web server). The
 * browser holds the full conversation and re-sends it every turn, so without
 * this a long chat on a small-window model silently overflows the context.
 *
 * A compactor is exactly a `MessageTransform`, so this is a one-line composition
 * on the shared loop seam. It runs before any prompt-hook rewrite (hooks compose
 * after), keeping the recent turns — including the new question — verbatim.
 */
export function wrapToolLoopAgentWithCompaction(
  loop: ToolLoopAgent,
  compact: HistoryCompactor,
): ToolLoopAgent {
  return withMessageTransforms(loop, [compact]);
}
