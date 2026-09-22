import type { ModelMessage } from 'ai';

import { messageText, messageTranscript } from './message.js';

/** Rough token estimate. We don't ship a tokenizer (it would be provider-
 *  specific and a build-time dependency); ~4 chars/token is close enough to
 *  decide *when* to compact, which is all the budget math needs. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function messageTokens(message: ModelMessage): number {
  // Tool calls and tool results are most of a long session. messageText drops
  // them, which would let a transcript of huge tool output look like it fits.
  return estimateTokens(messageTranscript(message));
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
  /** Persist the verbatim older turns and return a path the agent can search
   *  later. The summary is lossy; the file is not. */
  archive?: (transcript: string) => Promise<string | undefined>;
}

/** Summarizer input cap. The history file keeps the full text; the model that
 *  writes the summary only needs the ends of a very long transcript. */
export const SUMMARY_INPUT_CHARS = 80_000;

const HISTORY_FILE_RE = /<history_file>([^<]+)<\/history_file>/g;

export function boundTranscript(full: string, maxChars = SUMMARY_INPUT_CHARS): string {
  if (full.length <= maxChars) return full;
  const tailChars = Math.min(24_000, Math.floor(maxChars / 3));
  const headChars = maxChars - tailChars;
  return `${full.slice(0, headChars)}\n\n[middle of the transcript omitted here; the history file has the full text]\n\n${full.slice(-tailChars)}`;
}

const DEFAULT_KEEP_RECENT = 6;

/**
 * Bring `messages` under `budget` (estimated tokens). The most recent
 * `keepRecent` messages are always preserved; everything older is either folded
 * into a single leading summary (when a summarizer is supplied) or dropped
 * behind a marker. Returns the input array unchanged when it already fits, so
 * the cacheable prefix is preserved on the common path.
 *
 * The older transcript is archived once. Prior `<history_file>` tags on those
 * turns are copied onto the new marker. If the summary still overflows, the
 * same file list goes on an omission marker — there is no second archive pass.
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
    return messages;
  }

  const full = renderTranscript(older);
  const archived = await archiveTranscript(opts.archive, full);
  const files = dedupe([...historyFilesIn(older), ...(archived ? [archived] : [])]);

  if (!opts.summarize) {
    return [historyMarker(undefined, older.length, files), ...recent];
  }

  const summary = await opts.summarize(boundTranscript(full));
  const summarized = [historyMarker(summary, older.length, files), ...recent];
  if (totalTokens(summarized) <= opts.budget) {
    return summarized;
  }
  return [historyMarker(undefined, older.length, files), ...recent];
}

function renderTranscript(messages: readonly ModelMessage[]): string {
  return messages.map((message) => `## ${message.role}\n${messageTranscript(message)}`).join('\n\n');
}

async function archiveTranscript(
  archive: FitOptions['archive'],
  transcript: string,
): Promise<string | undefined> {
  if (!archive) return undefined;
  try {
    const path = await archive(transcript);
    const trimmed = path?.trim();
    return trimmed ? trimmed : undefined;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`› context: failed to archive history: ${message}`);
    return undefined;
  }
}

function historyFilesIn(messages: readonly ModelMessage[]): string[] {
  const out: string[] = [];
  for (const message of messages) {
    for (const match of messageText(message).matchAll(HISTORY_FILE_RE)) {
      const file = match[1]?.trim();
      if (file) out.push(file);
    }
  }
  return out;
}

function dedupe(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

function historyMarker(
  summary: string | undefined,
  omittedCount: number,
  files: readonly string[],
): ModelMessage {
  const fileBlock =
    files.length === 0
      ? ''
      : `\n${files.map((file) => `<history_file>${file}</history_file>`).join('\n')}\nThe summary omits detail. Search each history file with context_grep before treating a missing path, symbol, line range, command, or decision as unknown.`;
  if (summary != null) {
    return {
      role: 'user',
      content: `<conversation_summary>\n${summary}\n</conversation_summary>${fileBlock}`,
    };
  }
  return {
    role: 'user',
    content: `[${omittedCount} earlier message(s) omitted to fit the context window]${fileBlock}`,
  };
}
