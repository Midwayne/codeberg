import { readdir, stat } from 'node:fs/promises';

import { clampInt, MAX_CONTEXT_CHARS, MAX_READ_LINES, safeCut } from './limits.js';
import type { ContextStore } from './store.js';
import { ContextReadError, textSegments, type TextSegment } from './text-stream.js';

export async function readContext(
  store: ContextStore,
  path: string,
  startLine?: number,
  endLine?: number,
  startColumn?: number,
): Promise<string> {
  const real = store.resolve(path);
  if (!real) return 'error: path not found or not allowed';

  const info = await stat(real);
  if (info.isDirectory()) {
    const entries = await readdir(real, { withFileTypes: true });

    return entries.map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`).sort().slice(0, 500).join('\n');
  }
  if (!info.isFile()) return 'error: path is not a file';

  try {
    return await readPage(real, startLine, endLine, startColumn);
  } catch (error) {
    if (error instanceof ContextReadError) return 'error: file is unreadable or too large';

    throw error;
  }
}

async function readPage(file: string, startLine?: number, endLine?: number, startColumn?: number) {
  const start = clampInt(startLine, 1, Number.MAX_SAFE_INTEGER);
  const column = clampInt(startColumn, 1, Number.MAX_SAFE_INTEGER);
  const end = Math.min(start + MAX_READ_LINES - 1, clampInt(endLine, start + 199, Number.MAX_SAFE_INTEGER));
  const parts: string[] = [];
  let size = 0;

  for await (const segment of textSegments(file)) {
    if (segment.line < start) continue;

    const offset = segment.line === start ? Math.max(0, column - segment.column) : 0;
    if (offset > segment.text.length || (offset === segment.text.length && !segment.end)) continue;

    const next = { ...segment, column: segment.column + offset, text: segment.text.slice(offset) };
    const label = `${next.line}${next.column > 1 ? `:${next.column}` : ''}|`;
    const room = MAX_CONTEXT_CHARS - size - label.length - 1;
    if (segment.line > Math.max(start, end) || room <= 0) return continuation(parts, next);

    const cut = safeCut(next.text, room);
    const piece = label + next.text.slice(0, cut);
    parts.push(piece);
    size += piece.length + 1;
    if (cut < next.text.length) return continuation(parts, { ...next, column: next.column + cut });
  }

  return parts.length ? parts.join('\n') : 'error: requested position is past end of file';
}

function continuation(parts: string[], next: TextSegment): string {
  return `${parts.join('\n')}\n[More text: use context_read with next_start_line=${next.line}; next_start_column=${next.column} as start_line/start_column.]`;
}
