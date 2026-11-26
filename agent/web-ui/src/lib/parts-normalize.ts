import { clamp, record } from './backdrop-normalize';
import { ensureContrast, hexColor, luminance, mix, opaque, readableOn } from './color';
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

  if (background) style.background = background;
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

const isDark = (color: string) => luminance(opaque(color)) < 0.18;

/*
 * Code highlighting follows the theme's light or dark mode, so a code block
 * background of the opposite kind would leave highlighted code unreadable.
 * Such a background (and its text color) is dropped; border and radius stay.
 */
function fitCode(style: PartStyle, palette: Palette): PartStyle {
  if (!style.background || isDark(style.background) === isDark(palette.background)) return style;

  const { background: _background, text: _text, ...rest } = style;

  return rest;
}

/*
 * Each part's text reaches 4.5:1 on that part's own background, and on that
 * background seen through its glass over the theme's background.
 */
function readable(name: ThemePart, style: PartStyle, palette: Palette): PartStyle {
  if (!style.background && !style.text) return style;

  const surface = opaque(style.background ?? defaultSurface(name, palette));
  const seenThrough = mix(surface, palette.background, 1 - (style.glass ?? 1));
  const text = ensureContrast(opaque(style.text ?? palette.foreground), [surface, seenThrough], 4.5, readableOn(surface));

  return { ...style, text };
}

/** Valid per-part styles only, each with readable text. */
export function normalizeParts(value: unknown, palette: Palette): Parts | undefined {
  const raw = record(value);
  if (!raw) return undefined;

  const parts: Parts = {};

  for (const name of THEME_PARTS) {
    const style = part(name, raw[name]);
    const fitted = style && name === 'code' ? fitCode(style, palette) : style;

    if (fitted && Object.keys(fitted).length > 0) parts[name] = readable(name, fitted, palette);
  }

  return Object.keys(parts).length > 0 ? parts : undefined;
}
