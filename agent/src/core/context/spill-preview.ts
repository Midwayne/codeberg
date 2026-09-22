const SPILL_PREFIX = '[spilled to ';
const RESULT_COUNT = /; result_count=(\d+);/;

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
