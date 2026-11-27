/* Small readers for untrusted theme values, shared by every theme normalizer. */

/** A number clamped to a range, or the fallback when it is not a number. */
export function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) return fallback;

  return Math.min(max, Math.max(min, number));
}

export function choice<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
