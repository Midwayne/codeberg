import { choice, clamp, record } from './normalize-values';
import { sanitizeSvg } from './svg-sanitize';
import { ART_ANCHORS, ART_ANIMATIONS, SPRITE_ANIMATIONS, type BackdropArt, type BackdropSprite } from './theme-types';

export const MAX_ART = 4;

export const MAX_SPRITES = 3;

/* Copies across all sprite layers; each is a composited image, so this bounds the frame cost. */
const MAX_SPRITE_COPIES = 48;

/** Valid art pieces, each drawing rebuilt from the SVG allowlist; undefined when none is left. */
export function normalizeArt(value: unknown, animated: boolean): BackdropArt[] | undefined {
  const pieces = (Array.isArray(value) ? value : [])
    .slice(0, MAX_ART)
    .map((entry) => artPiece(entry, animated))
    .filter((entry): entry is BackdropArt => entry !== undefined);

  return pieces.length > 0 ? pieces : undefined;
}

function artPiece(value: unknown, animated: boolean): BackdropArt | undefined {
  const raw = record(value);
  const svg = sanitizeSvg(raw?.svg, animated);
  if (!raw || !svg) return undefined;

  const animation = choice(raw.animation, ART_ANIMATIONS, 'none');

  return {
    svg,
    anchor: choice(raw.anchor, ART_ANCHORS, 'right'),
    size: clamp(raw.size, 10, 60, 28),
    opacity: clamp(raw.opacity, 0.05, 1, 0.8),
    flip: raw.flip === true,
    animation: animated ? animation : 'none',
    duration: clamp(raw.duration, 4, 120, 16),
  };
}

/** Valid sprite layers with at most 48 copies between them; undefined when none is left. */
export function normalizeSprites(value: unknown, animated: boolean): BackdropSprite[] | undefined {
  let room = MAX_SPRITE_COPIES;
  const sprites: BackdropSprite[] = [];

  for (const entry of (Array.isArray(value) ? value : []).slice(0, MAX_SPRITES)) {
    const sprite = spriteLayer(entry, animated, room);
    if (!sprite) continue;

    sprites.push(sprite);
    room -= sprite.count;
  }

  return sprites.length > 0 ? sprites : undefined;
}

function spriteLayer(value: unknown, animated: boolean, room: number): BackdropSprite | undefined {
  const raw = record(value);
  const svg = sanitizeSvg(raw?.svg, animated);
  if (!raw || !svg || room < 1) return undefined;

  const animation = choice(raw.animation, SPRITE_ANIMATIONS, 'fall');

  return {
    svg,
    count: Math.round(clamp(raw.count, 1, Math.min(24, room), 12)),
    size: clamp(raw.size, 6, 72, 18),
    opacity: clamp(raw.opacity, 0.05, 1, 0.7),
    animation: animated ? animation : 'none',
    duration: clamp(raw.duration, 4, 120, 24),
    spin: raw.spin !== false,
  };
}
