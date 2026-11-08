export const SPILL_PREFIX = '[spilled to ';

const RESULT_COUNT = /; result_count=(\d+);/;

/** Source of {@link RESULT_COUNT}, for the fallback page script. */
export const SPILL_RESULT_COUNT_SOURCE = RESULT_COUNT.source;

/** The first line of a spill preview. The parser recognizes `SPILL_PREFIX` and the count clause. */
export function spillHeader(file: string, chars: number, resultCount?: number): string {
  const count = resultCount == null ? '' : `; result_count=${resultCount}`;

  return `${SPILL_PREFIX}${file} — ${chars} chars${count}; the middle is only in that file]`;
}

export function isSpillPreview(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(SPILL_PREFIX);
}

/** Number of top-level array items recorded before a structured result was spilled. */
export function spillResultCount(value: unknown): number | undefined {
  if (!isSpillPreview(value)) return undefined;

  const match = RESULT_COUNT.exec(value);
  if (!match) return undefined;

  const count = Number(match[1]);

  return Number.isSafeInteger(count) ? count : undefined;
}
