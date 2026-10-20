import type { ContextStore } from './store.js';
import { clampInt, MAX_CONTEXT_CHARS, MAX_SEGMENT_CHARS, MAX_TAIL_LINES, safeStart } from './limits.js';
import { ContextReadError, textSegments } from './text-stream.js';

export async function tailContext(store: ContextStore, path: string, lines?: number): Promise<string> {
  const real = store.resolve(path);
  if (!real) return 'error: path not found or not allowed';

  try {
    return await tailPage(real, clampInt(lines, 80, MAX_TAIL_LINES));
  } catch (error) {
    if (error instanceof ContextReadError) return 'error: file is unreadable or too large';

    throw error;
  }
}

async function tailPage(file: string, limit: number): Promise<string> {
  const kept: string[] = [];
  let text = '';
  let size = 0;

  for await (const segment of textSegments(file)) {
    const combined = text + segment.text;
    text = combined.slice(safeStart(combined, combined.length - MAX_SEGMENT_CHARS));
    if (!segment.end) continue;

    const column = Math.max(1, segment.column + segment.text.length - text.length);
    const entry = `${segment.line}${column > 1 ? `:${column}` : ''}|${text}`;
    kept.push(entry);
    size += entry.length + 1;
    text = '';

    while (kept.length > limit || size > MAX_CONTEXT_CHARS) {
      size -= kept.shift()!.length + 1;
    }
  }

  return kept.join('\n');
}
