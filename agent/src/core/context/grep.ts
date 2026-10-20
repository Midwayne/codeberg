import { clampInt, MAX_CONTEXT_CHARS, MAX_SEGMENT_CHARS, safeCut, safeStart } from './limits.js';
import { collectFiles } from './files.js';
import type { ContextStore } from './store.js';
import { ContextReadError, textSegments } from './text-stream.js';

interface GrepInput {
  pattern: string;
  path?: string;
  literal?: boolean;
  limit?: number;
}

export async function grepContext(store: ContextStore, input: GrepInput): Promise<string> {
  if (!input.pattern) return 'error: pattern is required';

  if (input.pattern.length > 500) return 'error: pattern is too long';

  let regex: RegExp;
  try {
    regex = new RegExp(input.literal === false ? input.pattern : escapeRegExp(input.pattern));
  } catch (error) {
    return `error: invalid regular expression: ${error instanceof Error ? error.message : String(error)}`;
  }

  const files = await collectFiles(store, input.path || '.');
  if (files.length === 0) return 'error: path not found or not allowed';

  return searchFiles(files, input, regex);
}

async function searchFiles(files: string[], input: GrepInput, regex: RegExp): Promise<string> {
  const limit = clampInt(input.limit, 40, 100);
  const matches: string[] = [];
  let size = 0;

  for (const file of files) {
    try {
      for await (const match of fileMatches(file, input, regex)) {
        const result = `${file}:${match}`;
        if (size + result.length > MAX_CONTEXT_CHARS) return `${matches.join('\n')}\n[Output limit reached; narrow the path or pattern.]`;

        matches.push(result);
        size += result.length + 1;
        if (matches.length >= limit) return `${matches.join('\n')}\n[Match limit reached; narrow the path or pattern.]`;
      }
    } catch (error) {
      if (!(error instanceof ContextReadError)) throw error;

      const note = `skipped (unreadable or too large): ${file}`;
      matches.push(note);
      size += note.length + 1;
      if (size >= MAX_CONTEXT_CHARS) break;
    }
  }

  return matches.length ? matches.join('\n') : 'no matches';
}

async function* fileMatches(file: string, input: GrepInput, regex: RegExp): AsyncGenerator<string> {
  let carry = '';
  let matched = false;
  const regexParts: string[] = [];

  for await (const segment of textSegments(file)) {
    if (input.literal === false) {
      regexParts.push(segment.text);
      if (!segment.end) continue;

      const text = regexParts.join('');
      regexParts.length = 0;
      const found = regex.exec(text);
      if (found) yield excerpt(segment.line, 1, text, found.index, false);
    } else if (!matched) {
      const text = carry + segment.text;
      const found = text.indexOf(input.pattern);
      if (found >= 0) {
        yield excerpt(segment.line, segment.column - carry.length, text, found, !segment.end);
        matched = true;
      }

      carry = text.slice(-Math.max(0, input.pattern.length - 1));
      if (input.pattern.length === 1) carry = '';
    }

    if (segment.end) {
      carry = '';
      matched = false;
    }
  }
}

function excerpt(line: number, column: number, text: string, match: number, more: boolean): string {
  const start = safeStart(text, match - 160);
  const shown = text.slice(start, start + safeCut(text.slice(start), MAX_SEGMENT_CHARS));
  const truncated = more || start > 0 || shown.length < text.length;
  const note = truncated ? ` [excerpt; column=${column + start}; use context_read start_line=${line} start_column=${column + start}]` : '';

  return `${line}:${shown}${note}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
