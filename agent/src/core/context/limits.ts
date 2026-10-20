export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_CONTEXT_CHARS = 8_000;
export const MAX_SEGMENT_CHARS = 2_000;
export const MAX_READ_LINES = 400;
export const MAX_TAIL_LINES = 400;

export function clampInt(value: unknown, fallback: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
  if (n < 1) return 1;

  return Math.min(n, max);
}

/** Keep page boundaries between complete UTF-16 surrogate pairs. */
export function safeCut(text: string, size: number): number {
  let end = Math.min(text.length, Math.max(0, size));
  if (end > 0 && end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end--;

  return end;
}

export function safeStart(text: string, from: number): number {
  const start = Math.max(0, from);

  return start > 0 && /[\uDC00-\uDFFF]/.test(text[start] ?? '') ? start + 1 : start;
}
