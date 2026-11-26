import type { CSSProperties } from 'react';

import { flakes, orbs, rain, stars } from './backdrop-patterns';
import type { BackdropLayer, CustomBackdrop } from './theme-types';

type LayerStyle = CSSProperties & Record<`--${string}`, string>;

const NOISE = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/* Sparse particles get wider tiles, so lights and flakes read as a scattered few. */
const SPREAD: Partial<Record<BackdropLayer['kind'], number>> = { orbs: 2.4, flakes: 1.5 };

/* Pattern spacing in pixels; glows and bands use size as a percentage instead. */
function spacing(layer: BackdropLayer): number {
  return Math.round((8 + layer.size * 1.6) * (SPREAD[layer.kind] ?? 1));
}

/*
 * The background that draws one layer, before opacity and animation. Softness
 * comes from the gradients themselves: a CSS blur on a moving full-screen layer
 * re-rasterizes every frame and drops the frame rate badly.
 */
function paint(layer: BackdropLayer): Pick<CSSProperties, 'backgroundImage' | 'backgroundSize'> {
  const { color, x, y, size, angle } = layer;
  const tile = spacing(layer);

  switch (layer.kind) {
    case 'glow':
      return { backgroundImage: `radial-gradient(ellipse ${size}% ${Math.round(size * 0.7)}% at ${x}% ${y}%, ${color}, transparent 70%)` };
    case 'band':
      return { backgroundImage: `linear-gradient(${angle}deg, transparent ${Math.max(0, y - 25)}%, ${color} ${y}%, transparent ${Math.min(100, y + 25)}%)` };
    case 'stars':
      return { backgroundImage: stars(color, tile), backgroundSize: `${tile}px ${tile}px` };
    case 'flakes':
      return { backgroundImage: flakes(color, tile), backgroundSize: `${tile}px ${tile}px` };
    case 'rain':
      return { backgroundImage: rain(color, tile), backgroundSize: `${tile}px ${tile}px` };
    case 'orbs':
      return { backgroundImage: orbs(color, tile), backgroundSize: `${tile}px ${tile}px` };
    case 'meteor':
      return { backgroundImage: `linear-gradient(90deg, transparent, ${color})` };
    case 'dots':
      return { backgroundImage: `radial-gradient(circle, ${color} 0 1.2px, transparent 1.6px)`, backgroundSize: `${tile}px ${tile}px` };
    case 'grid':
      return { backgroundImage: `linear-gradient(${color} 1px, transparent 1px), linear-gradient(90deg, ${color} 1px, transparent 1px)`, backgroundSize: `${tile}px ${tile}px` };
    case 'lines':
      return { backgroundImage: `repeating-linear-gradient(${angle}deg, ${color} 0 1px, transparent 1px ${Math.max(3, Math.round(tile / 4))}px)` };
    case 'noise':
      return { backgroundImage: NOISE };
    default:
      return never(layer.kind);
  }
}

function never(value: never): never {
  throw new Error(`Unknown backdrop layer: ${String(value)}`);
}

/** Inline styles for one layer; backdrop.css supplies the shared keyframes. */
export function layerStyle(layer: BackdropLayer): LayerStyle {
  const animated = layer.animation !== 'none';

  return {
    ...paint(layer),
    ...(layer.kind === 'meteor' ? meteorBox(layer) : {}),
    opacity: layer.animation === 'shoot' ? 0 : layer.opacity,
    '--layer-opacity': String(layer.opacity),
    '--layer-pan': `${spacing(layer)}px`,
    '--layer-angle': `${layer.angle}deg`,
    ...(animated ? { animation: `backdrop-${layer.animation} ${layer.duration}s ${timing(layer)} infinite ${direction(layer)}` } : {}),
  };
}

/* A streak at x, y whose length follows size, pointing along its angle; the bright head leads. */
function meteorBox(layer: BackdropLayer): CSSProperties {
  return {
    left: `${layer.x}%`,
    top: `${layer.y}%`,
    width: `${Math.round(layer.size * 2.4)}px`,
    height: '1.5px',
    transform: `rotate(${layer.angle}deg)`,
  };
}

/* Loops that travel a full tile or turn run at a steady speed and restart seamlessly. */
const LOOPS = new Set<BackdropLayer['animation']>(['pan', 'fall', 'rise', 'spin', 'shoot']);

function timing(layer: BackdropLayer): string {
  return LOOPS.has(layer.animation) ? 'linear' : 'ease-in-out';
}

function direction(layer: BackdropLayer): string {
  return LOOPS.has(layer.animation) ? 'normal' : 'alternate';
}

export function skyStyle(backdrop: CustomBackdrop): CSSProperties | undefined {
  if (!backdrop.sky) return undefined;

  const { from, to, angle } = backdrop.sky;

  return { backgroundImage: `linear-gradient(${angle}deg, ${from}, ${to})` };
}
