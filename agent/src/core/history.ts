import type { ModelMessage } from "ai";

/** Rough token estimate. We don't ship a tokenizer (it would be provider-
 *  specific and a build-time dependency); ~4 chars/token is close enough to
 *  decide *when* to compact, which is all the budget math needs. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Readable text of a message, ignoring tool-call/tool-result JSON parts —
 *  enough for budgeting and for building a summarization transcript. */
function textOf(content: ModelMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) =>
      part && typeof part === "object" && "text" in part &&
      typeof (part as { text: unknown }).text === "string"
        ? (part as { text: string }).text
        : "",
    )
    .join("");
}

export function messageTokens(message: ModelMessage): number {
  return estimateTokens(textOf(message.content));
}

export function totalTokens(messages: readonly ModelMessage[]): number {
  return messages.reduce((sum, m) => sum + messageTokens(m), 0);
}

export type Summarize = (transcript: string) => Promise<string>;

export interface FitOptions {
  /** Estimated-token ceiling for the returned transcript. */
  budget: number;
  /** Turns at the tail kept verbatim no matter what (recency). */
  keepRecent?: number;
  /** When provided, overflow is folded into one summary turn; otherwise the
   *  oldest turns are dropped behind a short marker. */
  summarize?: Summarize;
}

const DEFAULT_KEEP_RECENT = 6;

/**
 * Bring `messages` under `budget` (estimated tokens). The most recent
 * `keepRecent` messages are always preserved; everything older is either folded
 * into a single leading summary (when a summarizer is supplied) or dropped
 * behind a marker. Returns the input array unchanged when it already fits, so
 * the cacheable prefix is preserved on the common path.
 */
export async function fitHistory(
  messages: ModelMessage[],
  opts: FitOptions,
): Promise<ModelMessage[]> {
  if (totalTokens(messages) <= opts.budget) {
    return messages;
  }

  const keepRecent = opts.keepRecent ?? DEFAULT_KEEP_RECENT;
  const split = Math.max(0, messages.length - keepRecent);
  const older = messages.slice(0, split);
  const recent = messages.slice(split);
  if (older.length === 0) {
    // Everything we're allowed to keep is recent; can't compact further.
    return messages;
  }

  if (opts.summarize) {
    const transcript = older
      .map((m) => `${m.role}: ${textOf(m.content)}`)
      .join("\n");
    const summary = await opts.summarize(transcript);
    const marker: ModelMessage = {
      role: "user",
      content: `<conversation_summary>\n${summary}\n</conversation_summary>`,
    };
    // The summary + recent turns may still overflow; recurse without the
    // summarizer so the fallback trims the (now-summarized) older end.
    return fitHistory([marker, ...recent], { ...opts, summarize: undefined });
  }

  const marker: ModelMessage = {
    role: "user",
    content: `[${older.length} earlier message(s) omitted to fit the context window]`,
  };
  return [marker, ...recent];
}
