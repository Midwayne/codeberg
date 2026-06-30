import type { ModelMessage, ToolLoopAgent } from "ai";

/** Compacts a transcript to the model's history budget (summarizing the
 *  overflow). Same shape as `Agent.historyCompactor()`. */
export type HistoryCompactor = (
  messages: ModelMessage[],
) => Promise<ModelMessage[]>;

type StreamParams = Parameters<ToolLoopAgent["stream"]>[0];
type GenerateParams = Parameters<ToolLoopAgent["generate"]>[0];

/**
 * Wrap a `ToolLoopAgent` so each call's transcript is compacted to the model's
 * history budget before it is sent — the policy `Agent.ask` applies on the CLI,
 * made available to callers that drive the loop directly (the web server). The
 * browser holds the full conversation and re-sends it every turn, so without
 * this a long chat on a small-window model silently overflows the context.
 *
 * Compaction runs before any prompt-hook rewrite: it summarizes older turns and
 * keeps the recent ones (including the new question) verbatim, so `/enhance` and
 * friends still see the last user message intact.
 */
export function wrapToolLoopAgentWithCompaction(
  loop: ToolLoopAgent,
  compact: HistoryCompactor,
): ToolLoopAgent {
  async function rewrite<T extends StreamParams | GenerateParams>(
    params: T,
  ): Promise<T> {
    if ("messages" in params && Array.isArray(params.messages)) {
      return { ...params, messages: await compact(params.messages) } as T;
    }
    if ("prompt" in params && Array.isArray(params.prompt)) {
      return { ...params, prompt: await compact(params.prompt) } as T;
    }
    return params;
  }

  return new Proxy(loop, {
    get(target, prop) {
      if (prop === "stream") {
        return async (p: StreamParams) => target.stream(await rewrite(p));
      }
      if (prop === "generate") {
        return async (p: GenerateParams) => target.generate(await rewrite(p));
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as ToolLoopAgent;
}
