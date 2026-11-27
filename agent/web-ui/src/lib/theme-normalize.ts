import { choice, clamp, normalizeBackdrop } from './backdrop-normalize';
import { contrast, easeToward, ensureContrast, hexColor, mix, opaque, readableOn, sameKind } from './color';
import { normalizeParts } from './parts-normalize';
import {
  CODE_FONTS,
  THEME_FONTS,
  THEME_TRANSITIONS,
  type CustomTheme,
  type CustomThemeId,
  type Palette,
  type Theme,
} from './theme-types';

export class ThemeShapeError extends Error {}

type NormalizeOptions = {
  id: CustomThemeId;
  prompt: string;
  animated: boolean;
  /** The backdrop a reply of `"backdrop": "keep"` keeps, when changing a theme. */
  keep?: Theme['backdrop'];
};

/**
 * Turns a model-designed (or stored) theme into one the app can apply safely:
 * unknown fields are dropped, numbers clamped, and text made readable.
 */
export function normalizeTheme(value: unknown, options: NormalizeOptions): CustomTheme {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const palette = normalizePalette(raw.palette);

  // Dark exactly when text on it is white, so highlighting matches the text.
  const dark = readableOn(palette.background) === '#ffffff';
  const kept = raw.backdrop === 'keep' ? options.keep : raw.backdrop;

  // A kept backdrop is validated like any other, so Animated off still stills it.
  const validated = normalizeBackdrop(kept, options.animated);
  const backdrop = readableSky(validated, palette);
  const sky = typeof backdrop === 'object' && backdrop.sky ? [backdrop.sky.from, backdrop.sky.to] : [];

  const parts = normalizeParts(raw.parts, palette, sky);

  return {
    id: options.id,
    prompt: options.prompt,
    label: text(raw.label, 24) || 'My theme',
    description: text(raw.description, 48) || text(options.prompt, 48),
    colorScheme: dark ? 'dark' : 'light',
    heading: choice(raw.heading, THEME_FONTS, 'sans'),
    body: choice(raw.body, THEME_FONTS, 'sans'),
    code: choice(raw.code, CODE_FONTS, 'mono'),
    textScale: clamp(raw.textScale, 0.9, 1.15, 1),
    radius: `${clamp(raw.radius, 0, 1.5, 0.625)}rem`,
    transition: choice(raw.transition, THEME_TRANSITIONS, 'reveal'),
    palette,
    ...(backdrop ? { backdrop } : {}),
    ...(parts ? { parts } : {}),
  };
}

/* Margins and glass parts show the sky directly, so it eases toward the page until text reads on it. */
function readableSky(backdrop: Theme['backdrop'], palette: Palette): Theme['backdrop'] {
  if (typeof backdrop !== 'object' || !backdrop.sky) return backdrop;

  const reads = (color: string) =>
    contrast(palette.foreground, color) >= 4.5 && contrast(palette.mutedForeground, color) >= 4.5;
  const { from, to, angle } = backdrop.sky;
  const easedFrom = easeToward(from, palette.background, reads);
  const easedTo = easeToward(to, palette.background, reads);

  return { ...backdrop, sky: { from: easedFrom, to: easedTo, angle } };
}

function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, limit) : '';
}

/*
 * Surfaces sit under the same text as the page, so one of the opposite kind
 * (a light menu in a dark theme) is replaced by a slight lift of the page.
 */
function surfaceColor(value: unknown, fallback: string, base: string): string {
  const color = hexColor(value);
  if (!color) return fallback;

  return sameKind(opaque(color), base) ? opaque(color) : mix(base, readableOn(base), 0.08);
}

function normalizePalette(value: unknown): Palette {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const background = hexColor(raw.background);
  if (!background) throw new ThemeShapeError('The chat model’s theme had no background color. Try again.');

  const base = opaque(background);
  const surface = surfaceColor(raw.surface, base, base);
  const raised = surfaceColor(raw.raised, surface, base);
  const popover = surfaceColor(raw.popover, surface, base);
  const surfaces = [base, surface, raised, popover];

  return {
    background: base,
    surface,
    raised,
    popover,
    ...readableText(raw, surfaces),
    ...actionColors(raw, surfaces),
    border: hexColor(raw.border) ?? `${readableOn(base)}1f`,
  };
}

/** Body and secondary text reach 4.5:1 on every surface, nudged toward white or black if needed. */
function readableText(raw: Record<string, unknown>, surfaces: string[]) {
  const target = readableOn(surfaces[0]!);
  const foreground = ensureContrast(opaque(hexColor(raw.foreground) ?? target), surfaces, 4.5, target);
  const muted = opaque(hexColor(raw.mutedForeground) ?? foreground);

  return {
    foreground,
    mutedForeground: ensureContrast(muted, surfaces, 4.5, foreground),
    secondaryForeground: foreground,
  };
}

/* Buttons, and links and focus rings that read on every surface, not only the page. */
function actionColors(raw: Record<string, unknown>, surfaces: string[]) {
  const background = surfaces[0]!;
  const primary = opaque(hexColor(raw.primary) ?? readableOn(background));
  // Errors are text too (alerts, form errors), so they read on every surface.
  const destructive = ensureContrast(opaque(hexColor(raw.destructive) ?? '#e5484d'), surfaces, 4.5, readableOn(background));

  return {
    primary,
    primaryForeground: labelOn(primary, hexColor(raw.primaryForeground)),
    destructive,
    destructiveForeground: readableOn(destructive),
    ring: ensureContrast(primary, surfaces, 3, readableOn(background)),
    link: ensureContrast(opaque(hexColor(raw.link) ?? primary), surfaces, 4.5, readableOn(background)),
  };
}

/** The suggested label color when it reads on the button, otherwise white or black. */
function labelOn(button: string, suggested: string | undefined): string {
  if (suggested && contrast(opaque(suggested), button) >= 4.5) return opaque(suggested);

  return readableOn(button);
}
