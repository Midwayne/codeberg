import { hexColor } from './color';
import { LAYER_ANIMATIONS, LAYER_KINDS, type BackdropLayer, type CustomBackdrop } from './theme-types';

export const MAX_BACKDROP_LAYERS = 6;

/** A number clamped to a range, or the fallback when it is not a number. */
export function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) return fallback;

  return Math.min(max, Math.max(min, number));
}

export function choice<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function layer(value: unknown, animated: boolean): BackdropLayer | undefined {
  const raw = record(value);
  const color = hexColor(raw?.color);
  if (!raw || !color) return undefined;

  const animation = choice(raw.animation, LAYER_ANIMATIONS, 'none');

  return {
    kind: choice(raw.kind, LAYER_KINDS, 'glow'),
    color,
    opacity: clamp(raw.opacity, 0, 0.5, 0.15),
    x: clamp(raw.x, 0, 100, 50),
    y: clamp(raw.y, 0, 100, 30),
    size: clamp(raw.size, 5, 150, 50),
    angle: clamp(raw.angle, 0, 360, 135),
    animation: animated ? animation : 'none',
    duration: clamp(raw.duration, 4, 120, 30),
  };
}

function sky(value: unknown): CustomBackdrop['sky'] {
  const raw = record(value);
  const from = hexColor(raw?.from);
  const to = hexColor(raw?.to);

  return from && to ? { from, to, angle: clamp(raw?.angle, 0, 360, 180) } : undefined;
}

/** Keeps only valid layers, with every value clamped; undefined when nothing is left to draw. */
export function normalizeBackdrop(value: unknown, animated: boolean): CustomBackdrop | undefined {
  const raw = record(value);
  if (!raw) return undefined;

  const layers = (Array.isArray(raw.layers) ? raw.layers : [])
    .slice(0, MAX_BACKDROP_LAYERS)
    .map((entry) => layer(entry, animated))
    .filter((entry): entry is BackdropLayer => entry !== undefined);
  const base = sky(raw.sky);

  if (layers.length === 0 && !base) return undefined;

  return base ? { sky: base, layers } : { layers };
}
