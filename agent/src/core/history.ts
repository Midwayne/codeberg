import type { ModelMessage } from 'ai';

import { messageText, messageTranscript } from './message.js';
import { recentHistoryStart } from './history-recent.js';
import { totalTokens } from './history-tokens.js';
import { IncompleteSummaryError, isContextOverflow } from './context-errors.js';

export { estimateTokens, messageTokens, totalTokens } from './history-tokens.js';

export type Summarize = (transcript: string) => Promise<string>;

export interface FitOptions {
  /** Estimated-token ceiling for the returned transcript. */
  budget: number;
  /** Minimum messages kept verbatim, expanded to a whole user exchange.
   *  By default, use 25% of the budget, capped at 15K estimated tokens. */
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

  const note = '\n\n[middle omitted; the history file has the full transcript]\n\n';
  const available = Math.max(0, maxChars - note.length);
  const tailChars = Math.min(24_000, Math.floor(available / 3));
  const headChars = available - tailChars;

  return `${full.slice(0, headChars)}${note}${tailChars ? full.slice(-tailChars) : ''}`.slice(0, maxChars);
}

/**
 * Fit history to an estimated token budget, retaining recent whole exchanges.
 * The latest exchange is always preserved, even when it alone exceeds the
 * budget. Older exchanges are summarized or replaced by an archive marker.
 * Returns the input array unchanged when it fits, preserving cacheable prefixes.
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

  const split = recentHistoryStart(messages, opts.budget, opts.keepRecent);
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

  const summary = await summarizeArchived(opts.summarize, full, files);
  const summarized = [historyMarker(summary, older.length, files), ...recent];
  if (totalTokens(summarized) <= opts.budget) {
    return summarized;
  }

  return [historyMarker(undefined, older.length, files), ...recent];
}

async function summarizeArchived(summarize: Summarize, full: string, files: readonly string[]) {
  try {
    const summary = await summarize(boundTranscript(full));
    if (!summary.trim()) throw new IncompleteSummaryError();

    return summary;
  } catch (error) {
    if (files.length > 0 && (error instanceof IncompleteSummaryError || isContextOverflow(error))) {
      return undefined;
    }

    throw error;
  }
}

function renderTranscript(messages: readonly ModelMessage[]): string {
  return messages
    .map((message) => `## ${message.role}\n${messageTranscript(message)}`)
    .join('\n\n');
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
