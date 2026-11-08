import { setImmediate } from 'node:timers/promises';
import { createContext, Script, type Context } from 'node:vm';

import type { FileMatcher, Match } from './grep.js';
import { isContextReadError, textSegments } from './text-stream.js';

const BATCH_CHARS = 32 * 1024;
const BATCH_LINES = 4_096;
const REGEX_BATCH_TIMEOUT_MS = 250;
export const MAX_REGEX_GROUP_DEPTH = 32;

// V8 can abort the process when it compiles deeply nested groups.
export function exceedsRegexGroupDepth(pattern: string): boolean {
  let depth = 0;
  let inClass = false;

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '\\') {
      i++;
    } else if (inClass) {
      inClass = char !== ']';
    } else if (char === '[') {
      inClass = true;
    } else if (char === '(') {
      depth++;
      if (depth > MAX_REGEX_GROUP_DEPTH) return true;
    } else if (char === ')' && depth > 0) {
      depth--;
    }
  }

  return false;
}

// The script is fixed and receives the caller's pattern as a RegExp object.
const matchBatch = new Script(`
  ((state) => {
    const { regex, lines, limit, hits, end } = state;
    for (let i = state.next; i < end; i++) {
      const line = lines[i];
      const match = regex.exec(line.text);
      if (match) hits.push({ ...line, column: 1, index: match.index, length: match[0].length });

      state.next = i + 1;
      if (match && hits.length === limit) break;
    }
  })(state);
`);

export class RegexMatchError extends Error {
  constructor(readonly reason: 'timeout' | 'compile') {
    super(reason);
  }
}

interface BatchState {
  regex: RegExp;
  limit: number;
  lines: Line[];
  hits: Match[];
  next: number;
  end: number;
}

export function createRegexMatcher(regex: RegExp): FileMatcher {
  const state: BatchState = { regex, limit: 0, lines: [], hits: [], next: 0, end: 0 };
  const context = createContext({ state });

  return async function* matchFile(file, limit, signal) {
    state.limit = limit;

    try {
      for await (const lines of lineBatches(file, signal)) {
        state.lines = lines;
        state.next = 0;
        yield* matchLines(context, state, signal);

        if (state.limit === 0) return;
      }
    } finally {
      state.lines = [];
      state.hits = [];
    }
  };
}

async function* matchLines(context: Context, state: BatchState, signal?: AbortSignal): AsyncGenerator<Match> {
  let retrySingleLine = false;

  while (state.next < state.lines.length && state.limit > 0) {
    signal?.throwIfAborted();
    const start = state.next;
    state.end = retrySingleLine ? start + 1 : state.lines.length;
    state.hits = [];

    const failure = runBatch(context);
    const lastHit = state.hits.at(-1);
    // A timeout can interrupt between recording a hit and advancing the cursor.
    if (lastHit && lastHit.line === state.lines[state.next]?.line) state.hits.pop();

    state.limit -= state.hits.length;
    yield* state.hits;

    if (failure?.reason === 'compile') throw failure;
    if (failure && state.end === start + 1 && state.next === start) throw failure;

    retrySingleLine = failure?.reason === 'timeout' && state.next < state.end;
    if (retrySingleLine) await setImmediate();
  }
}

function runBatch(context: Context): RegexMatchError | undefined {
  try {
    matchBatch.runInContext(context, { timeout: REGEX_BATCH_TIMEOUT_MS });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') return new RegexMatchError('timeout');

    if (error instanceof SyntaxError) return new RegexMatchError('compile');

    throw error;
  }

  return undefined;
}

interface Line {
  line: number;
  text: string;
}

async function* lineBatches(file: string, signal?: AbortSignal): AsyncGenerator<Line[]> {
  const parts: string[] = [];
  let lines: Line[] = [];
  let chars = 0;

  try {
    for await (const segment of textSegments(file, signal)) {
      parts.push(segment.text);
      chars += segment.text.length;
      if (segment.end) {
        lines.push({ line: segment.line, text: parts.join('') });
        parts.length = 0;
      }

      if (lines.length === 0 || (chars < BATCH_CHARS && lines.length < BATCH_LINES)) continue;

      yield lines;
      lines = [];
      chars = segment.end ? 0 : segment.column - 1 + segment.text.length;
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (isContextReadError(error) && lines.length > 0) yield lines;

    throw error;
  }

  if (lines.length > 0) yield lines;
}
