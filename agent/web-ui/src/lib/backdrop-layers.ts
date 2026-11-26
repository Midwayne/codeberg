import type { CSSProperties } from 'react';

import type { BackdropLayer, CustomBackdrop } from './theme-types';

type LayerStyle = CSSProperties & Record<`--${string}`, string>;

const NOISE = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/* Pattern spacing in pixels; glows and bands use size as a percentage instead. */
function spacing(layer: BackdropLayer): number {
  return Math.round(8 + layer.size * 1.6);
}

function stars(color: string, tile: number): string {
  const points = [[0.08, 0.12, 1], [0.54, 0.31, 1], [0.35, 0.62, 1.5], [0.81, 0.81, 1], [0.92, 0.18, 1.5]];

  return points
    .map(([x, y, radius]) => `radial-gradient(${radius}px ${radius}px at ${Math.round(x! * tile)}px ${Math.round(y! * tile)}px, ${color}, transparent)`)
    .join(', ');
}

/** The background that draws one layer, before opacity and animation. */
function paint(layer: BackdropLayer): Pick<CSSProperties, 'backgroundImage' | 'backgroundSize' | 'filter'> {
  const { color, x, y, size, angle } = layer;
  const tile = spacing(layer);

  switch (layer.kind) {
    case 'glow':
      return { backgroundImage: `radial-gradient(ellipse ${size}% ${Math.round(size * 0.7)}% at ${x}% ${y}%, ${color}, transparent 70%)`, filter: 'blur(24px)' };
    case 'band':
      return { backgroundImage: `linear-gradient(${angle}deg, transparent ${Math.max(0, y - 20)}%, ${color} ${y}%, transparent ${Math.min(100, y + 20)}%)`, filter: 'blur(36px)' };
    case 'stars':
      return { backgroundImage: stars(color, tile), backgroundSize: `${tile}px ${tile}px` };
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
    opacity: layer.opacity,
    '--layer-opacity': String(layer.opacity),
    '--layer-pan': `${spacing(layer)}px`,
    ...(animated ? { animation: `backdrop-${layer.animation} ${layer.duration}s ${timing(layer)} infinite ${direction(layer)}` } : {}),
  };
}

function timing(layer: BackdropLayer): string {
  return layer.animation === 'pan' || layer.animation === 'spin' ? 'linear' : 'ease-in-out';
}

function direction(layer: BackdropLayer): string {
  return layer.animation === 'pan' || layer.animation === 'spin' ? 'normal' : 'alternate';
}

export function skyStyle(backdrop: CustomBackdrop): CSSProperties | undefined {
  if (!backdrop.sky) return undefined;

  const { from, to, angle } = backdrop.sky;

  return { backgroundImage: `linear-gradient(${angle}deg, ${from}, ${to})` };
}
