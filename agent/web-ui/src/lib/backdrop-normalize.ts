import { hexColor } from './color';
import { BACKDROP_SCENES, LAYER_ANIMATIONS, LAYER_KINDS, type BackdropLayer, type BackdropScene, type CustomBackdrop } from './theme-types';

export const MAX_BACKDROP_LAYERS = 6;

/** What a layer gets for anything it leaves out, built-in or generated. */
export const LAYER_DEFAULTS = {
  opacity: 0.15, x: 50, y: 30, size: 50, angle: 135, animation: 'none', duration: 30,
} as const satisfies Omit<BackdropLayer, 'kind' | 'color'>;

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

function layer(value: unknown, animated: boolean): BackdropLayer | undefined {
  const raw = record(value);
  const color = hexColor(raw?.color);
  if (!raw || !color) return undefined;

  const kind = choice(raw.kind, LAYER_KINDS, 'glow');
  const animation = fitAnimation(kind, choice(raw.animation, LAYER_ANIMATIONS, 'none'));

  return {
    kind,
    color,
    opacity: clamp(raw.opacity, 0, kind === 'glow' || kind === 'band' ? 0.5 : 1, LAYER_DEFAULTS.opacity),
    x: clamp(raw.x, 0, 100, LAYER_DEFAULTS.x),
    y: clamp(raw.y, 0, 100, LAYER_DEFAULTS.y),
    size: clamp(raw.size, 5, 150, LAYER_DEFAULTS.size),
    angle: clamp(raw.angle, 0, 360, LAYER_DEFAULTS.angle),
    animation: animated ? animation : 'none',
    duration: clamp(raw.duration, minimumDuration(animation), 120, LAYER_DEFAULTS.duration),
  };
}

/*
 * Motion may be quick (built-in rain loops in under a second), but anything
 * that changes brightness stays at 4 seconds or slower, far from the three
 * flashes a second that can trigger photosensitive reactions.
 */
function minimumDuration(animation: BackdropLayer['animation']): number {
  return animation === 'pulse' || animation === 'twinkle' || animation === 'shoot' ? 4 : 0.5;
}

/* Loops that travel one pattern tile; they suit patterns, not soft lights. */
const TILE_LOOPS = new Set<BackdropLayer['animation']>(['pan', 'fall', 'rise']);

/*
 * A shooting star only streaks (`shoot`) or stays still; any other motion would
 * replace its rotation. `shoot` hides a layer between streaks, so it is for
 * shooting stars only. Glows and bands have no tile to loop over, so they drift
 * or pulse instead of panning, falling, or rising.
 */
function fitAnimation(kind: BackdropLayer['kind'], animation: BackdropLayer['animation']): BackdropLayer['animation'] {
  if (kind === 'meteor') return animation === 'shoot' ? 'shoot' : 'none';

  if (animation === 'shoot') return 'none';

  return (kind === 'glow' || kind === 'band') && TILE_LOOPS.has(animation) ? 'drift' : animation;
}

function sky(value: unknown): CustomBackdrop['sky'] {
  const raw = record(value);
  const from = hexColor(raw?.from);
  const to = hexColor(raw?.to);

  return from && to ? { from, to, angle: clamp(raw?.angle, 0, 360, 180) } : undefined;
}

/**
 * A built-in scene name (kept by themes made from a built-in one), or valid
 * layers with every value clamped; undefined when nothing is left to draw.
 */
export function normalizeBackdrop(value: unknown, animated: boolean): BackdropScene | CustomBackdrop | undefined {
  if (BACKDROP_SCENES.includes(value as BackdropScene)) return value as BackdropScene;

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
