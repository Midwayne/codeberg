import type { CSSProperties } from 'react';

import type { BackdropArt, BackdropSprite } from './theme-types';

type Style = CSSProperties & Record<`--${string}`, string>;

/* The point art grows from, so a sway pivots where a branch would attach. */
const ORIGIN: Record<BackdropArt['anchor'], string> = {
  left: 'left center',
  right: 'right center',
  top: 'center top',
  bottom: 'center bottom',
  'top-left': 'left top',
  'top-right': 'right top',
  'bottom-left': 'left bottom',
  'bottom-right': 'right bottom',
};

/** The box art fills at its anchor; backdrop-art.css places it by data-anchor. */
export function artBoxStyle(art: BackdropArt): Style {
  return {
    '--art-size': `${art.size}%`,
    opacity: art.opacity,
    ...(art.flip ? { transform: 'scaleX(-1)' } : {}),
  };
}

/** The drawing inside its box: kept whole and pressed into the anchor's edge, moving as asked. */
export function artImageStyle(art: BackdropArt): CSSProperties {
  // A flipped box mirrors its content, so the drawing is pinned to the opposite side to land on the anchor.
  const origin = art.flip ? mirror(ORIGIN[art.anchor]) : ORIGIN[art.anchor];

  return {
    objectPosition: origin,
    transformOrigin: origin,
    ...(art.animation === 'none' ? {} : { animation: `art-${art.animation} ${art.duration}s ease-in-out infinite alternate` }),
  };
}

function mirror(position: string): string {
  return position.replace(/left|right/, (side) => (side === 'left' ? 'right' : 'left'));
}

/* Evenly scattered but irregular-looking fractions, the same on every render. */
function spread(index: number, seed: number): number {
  const value = Math.sin((index + 1) * 12.9898 + seed * 78.233) * 43758.5453;

  return value - Math.floor(value);
}

/** One scattered copy of a sprite: its place, scale, and offset in the shared cycle. */
export function spriteStyle(sprite: BackdropSprite, index: number, layer: number): Style {
  const x = spread(index, layer + 1) * 100;
  const y = spread(index, layer + 7) * 100;
  const scale = 0.6 + spread(index, layer + 13) * 0.8;
  // Each copy is partway through its trip already, so the window never starts empty.
  const delay = -spread(index, layer + 19) * sprite.duration;
  const turn = sprite.spin ? Math.round((spread(index, layer + 23) - 0.5) * 720) : 0;
  const sway = Math.round((spread(index, layer + 29) - 0.5) * 16);

  return {
    left: `${x.toFixed(1)}%`,
    width: `${Math.round(sprite.size * scale)}px`,
    opacity: sprite.opacity,
    '--sprite-y': `${y.toFixed(1)}%`,
    '--sprite-turn': `${turn}deg`,
    '--sprite-sway': `${sway}cqw`,
    ...(sprite.animation === 'none' ? {} : spriteMotion(sprite, scale, delay)),
  };
}

/* Nearer (larger) copies move a little faster, which reads as depth. */
function spriteMotion(sprite: BackdropSprite, scale: number, delay: number): CSSProperties {
  const duration = sprite.animation === 'float' ? sprite.duration / 3 : sprite.duration / (0.7 + scale * 0.4);
  const loop = sprite.animation === 'float' ? 'ease-in-out infinite alternate' : 'linear infinite';

  return { animation: `sprite-${sprite.animation} ${duration.toFixed(2)}s ${loop} ${delay.toFixed(2)}s` };
}
