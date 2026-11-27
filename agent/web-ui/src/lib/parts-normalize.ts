import { clamp, record } from './backdrop-normalize';
import { contrast, easeToward, ensureContrast, hexColor, mix, opaque, readableOn, sameKind } from './color';
import { PART_GLASS } from './theme-tokens';
import { THEME_PARTS, type Palette, type PartStyle, type ThemePart } from './theme-types';

/* Radii only shape these parts; the header and sidebar are full-width bars. */
const ROUNDED = new Set<ThemePart>(['composer', 'bubble', 'code']);

function part(name: ThemePart, value: unknown): PartStyle | undefined {
  const raw = record(value);
  if (!raw) return undefined;

  const style: PartStyle = {};
  const background = hexColor(raw.background);
  const text = hexColor(raw.text);
  const border = hexColor(raw.border);

  // Glass sets how see-through a part is, so a background's own alpha is dropped.
  if (background) style.background = opaque(background);
  if (text) style.text = text;
  if (border) style.border = border;
  if (raw.glass !== undefined) style.glass = clamp(raw.glass, 0.5, 1, 0.8);
  if (ROUNDED.has(name) && raw.radius !== undefined) style.radius = clamp(raw.radius, 0, 2, 1);

  return Object.keys(style).length > 0 ? style : undefined;
}

type Parts = Partial<Record<ThemePart, PartStyle>>;

/* The palette surface each part sits on when it keeps its default background. */
function defaultSurface(name: ThemePart, palette: Palette): string {
  if (name === 'bubble') return palette.raised;

  return name === 'composer' || name === 'code' ? palette.surface : palette.background;
}

/*
 * A part's own text is set below, but secondary text inside it (labels, the
 * composer placeholder, muted rows) keeps the palette's muted color. So a part
 * background must be the page's kind and close enough for that to read: one
 * of the opposite kind is dropped (for code it would also clash with syntax
 * highlighting), and one of the same kind eases toward the page until it fits.
 */
function fitBackground(style: PartStyle, palette: Palette): PartStyle {
  if (!style.background) return style;

  if (!sameKind(style.background, palette.background)) {
    const { background: _background, text: _text, ...rest } = style;

    return rest;
  }

  const background = easeToward(style.background, palette.background,
    (candidate) => contrast(palette.mutedForeground, candidate) >= 4.5);

  return { ...style, background };
}

/*
 * Each part's text reaches 4.5:1 on that part's own background, and on that
 * background seen through its glass (the theme's, or the part's default) over
 * whatever is behind it: the page, or the backdrop's sky.
 */
function readable(name: ThemePart, style: PartStyle, palette: Palette, behind: string[]): PartStyle {
  if (!style.background && !style.text) return style;

  const surface = opaque(style.background ?? defaultSurface(name, palette));
  const see = 1 - (style.glass ?? PART_GLASS[name]);
  const seenThrough = behind.map((color) => mix(surface, opaque(color), see));
  const text = ensureContrast(opaque(style.text ?? palette.foreground), [surface, ...seenThrough], 4.5, readableOn(surface));

  // A fixed key order keeps a second validation of a stored theme identical to the first.
  return ordered({ ...style, text });
}

function ordered(style: PartStyle): PartStyle {
  const { background, text, border, glass, radius } = style;

  return Object.fromEntries(
    Object.entries({ background, text, border, glass, radius }).filter(([, value]) => value !== undefined),
  ) as PartStyle;
}

/** Valid per-part styles only, each with readable text; `sky` is the backdrop's gradient ends. */
export function normalizeParts(value: unknown, palette: Palette, sky: string[] = []): Parts | undefined {
  const raw = record(value);
  if (!raw) return undefined;

  const parts: Parts = {};

  for (const name of THEME_PARTS) {
    const style = part(name, raw[name]);
    const fitted = style && fitBackground(style, palette);

    if (fitted && Object.keys(fitted).length > 0) parts[name] = readable(name, fitted, palette, [palette.background, ...sky]);
  }

  return Object.keys(parts).length > 0 ? parts : undefined;
}
