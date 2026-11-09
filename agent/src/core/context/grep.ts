import { collectFiles } from './files.js';
import { createRegexMatcher, exceedsRegexGroupDepth, MAX_REGEX_GROUP_DEPTH, RegexMatchError } from './grep-regex.js';
import { clampInt, MAX_CONTEXT_CHARS, MAX_SEGMENT_CHARS, safeCut, safeStart } from './limits.js';
import type { ContextStore } from './store.js';
import { CONTEXT_PATH_DENIED, isContextReadError, textSegments } from './text-stream.js';

export const MAX_GREP_PATTERN = 16_384;

const EXCERPT_PREFIX = 160;
const OUTPUT_LIMIT = '[Output limit reached; narrow the path or pattern.]';
const MATCH_LIMIT = '[Match limit reached; narrow the path or pattern.]';
const REGEX_FAILURE = {
  timeout: '[Regular expression timed out; simplify the pattern or use literal search.]',
  compile: '[Regular expression could not be compiled; simplify the pattern or use literal search.]',
  budget: '[Regex search time limit reached; narrow the path, simplify the pattern, or use literal search.]',
};
const OUTPUT_ROOM = MAX_CONTEXT_CHARS - Math.max(
  OUTPUT_LIMIT.length, MATCH_LIMIT.length, ...Object.values(REGEX_FAILURE).map((notice) => notice.length),
) - 1;

interface GrepInput {
  pattern: string;
  path?: string;
  literal?: boolean;
  limit?: number;
}

export interface Match {
  line: number;
  column: number;
  text: string;
  index: number;
  length: number;
  more?: boolean;
}

export type FileMatcher = (file: string, limit: number, signal?: AbortSignal) => AsyncIterable<Match>;

export async function grepContext(store: ContextStore, input: GrepInput, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  if (typeof input.pattern !== 'string' || !input.pattern) return 'error: pattern is required';

  if (input.pattern.length > MAX_GREP_PATTERN) {
    return `error: pattern is too long (maximum ${MAX_GREP_PATTERN.toLocaleString('en-US')} UTF-16 code units); use a shorter distinctive fragment`;
  }

  if (input.literal !== false && input.pattern.includes('\n')) {
    return 'error: context_grep matches one line at a time; search for a distinctive line, then use context_read';
  }

  const matcher = buildMatcher(input);
  if (typeof matcher === 'string') return matcher;

  let files: string[];
  try {
    files = await collectFiles(store, input.path || '.', signal);
  } catch (error) {
    signal?.throwIfAborted();
    if (isContextReadError(error)) return 'error: search path is unreadable';

    throw error;
  }

  if (files.length === 0) return CONTEXT_PATH_DENIED;

  return searchFiles(files, matcher, clampInt(input.limit, 40, 100), signal);
}

function buildMatcher(input: GrepInput): FileMatcher | string {
  if (input.literal !== false) {
    return (file, _limit, signal) => literalMatches(file, input.pattern, signal);
  }

  if (exceedsRegexGroupDepth(input.pattern)) {
    return `error: regular expressions support at most ${MAX_REGEX_GROUP_DEPTH} nested groups; simplify the pattern or use literal search`;
  }

  try {
    const regex = new RegExp(input.pattern);

    return createRegexMatcher(regex);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;

    const separator = error.message.lastIndexOf('/: ');
    const reason = separator >= 0 ? error.message.slice(separator + 3) : 'check the pattern syntax';

    return `error: invalid regular expression: ${reason}`;
  }
}

async function searchFiles(files: string[], matcher: FileMatcher, limit: number, signal?: AbortSignal): Promise<string> {
  const rows: string[] = [];
  let size = 0;
  let count = 0;

  for (const file of files) {
    signal?.throwIfAborted();
    try {
      for await (const match of matcher(file, limit - count, signal)) {
        const row = `${file}:${excerpt(match)}`;
        if (size + row.length > OUTPUT_ROOM) return [...rows, OUTPUT_LIMIT].join('\n');

        rows.push(row);
        size += row.length + 1;
        count++;

        if (count >= limit) return [...rows, MATCH_LIMIT].join('\n');
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof RegexMatchError) return [...rows, REGEX_FAILURE[error.reason]].join('\n');

      if (!isContextReadError(error)) throw error;

      const note = `skipped (unreadable or too large): ${file}`;
      if (size + note.length > OUTPUT_ROOM) return [...rows, OUTPUT_LIMIT].join('\n');

      rows.push(note);
      size += note.length + 1;
    }
  }

  return rows.length ? rows.join('\n') : 'no matches';
}

async function* literalMatches(file: string, pattern: string, signal?: AbortSignal): AsyncGenerator<Match> {
  const overlap = pattern.length - 1 + EXCERPT_PREFIX;
  let carry = '';
  let matched = false;

  for await (const segment of textSegments(file, signal)) {
    if (!matched) {
      const text = carry + segment.text;
      const index = text.indexOf(pattern);
      if (index >= 0) {
        yield {
          line: segment.line,
          column: segment.column - carry.length,
          text,
          index,
          length: pattern.length,
          more: !segment.end,
        };

        matched = true;
      }

      carry = matched ? '' : text.slice(safeStart(text, text.length - overlap));
    }

    if (segment.end) {
      carry = '';
      matched = false;
    }
  }
}

function excerpt({ line, column, text, index, length, more }: Match): string {
  const prefix = Math.min(EXCERPT_PREFIX, Math.max(0, MAX_SEGMENT_CHARS - length));
  const readOffset = safeCut(text, index);
  const start = Math.min(readOffset, safeStart(text, index - prefix));
  const rest = text.slice(start);
  const shown = rest.slice(0, safeCut(rest, MAX_SEGMENT_CHARS));
  if (!more && column === 1 && start === 0 && shown.length === text.length) return `${line}:${shown}`;

  const matchColumn = column + index;
  const readColumn = column + readOffset;
  const note = `column=${column + start}; match_column=${matchColumn}; match_length=${length}`;

  return `${line}:${shown} [excerpt; ${note}; use context_read start_line=${line} start_column=${readColumn}]`;
}
