import { choice, clamp, normalizeBackdrop } from './backdrop-normalize';
import { contrast, ensureContrast, hexColor, luminance, opaque, readableOn } from './color';
import {
  THEME_TRANSITIONS,
  type CustomTheme,
  type CustomThemeId,
  type Palette,
  type ThemeFont,
} from './theme-types';

const FONTS: readonly ThemeFont[] = ['sans', 'serif', 'mono'];

export class ThemeShapeError extends Error {}

type NormalizeOptions = { id: CustomThemeId; prompt: string; animated: boolean };

/**
 * Turns a model-designed (or stored) theme into one the app can apply safely:
 * unknown fields are dropped, numbers clamped, and text made readable.
 */
export function normalizeTheme(value: unknown, options: NormalizeOptions): CustomTheme {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const palette = normalizePalette(raw.palette);
  const dark = luminance(palette.background) < 0.18;
  const backdrop = normalizeBackdrop(raw.backdrop, options.animated);

  return {
    id: options.id,
    prompt: options.prompt,
    label: text(raw.label, 24) || 'My theme',
    description: text(raw.description, 48) || text(options.prompt, 48),
    colorScheme: dark ? 'dark' : 'light',
    heading: choice(raw.heading, FONTS, 'sans'),
    body: choice(raw.body, FONTS, 'sans'),
    radius: `${clamp(raw.radius, 0, 1.5, 0.625)}rem`,
    transition: choice(raw.transition, THEME_TRANSITIONS, 'reveal'),
    palette,
    ...(backdrop ? { backdrop } : {}),
  };
}

function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, limit) : '';
}

function surfaceColor(value: unknown, fallback: string): string {
  const color = hexColor(value);

  return color ? opaque(color) : fallback;
}

function normalizePalette(value: unknown): Palette {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const background = hexColor(raw.background);
  if (!background) throw new ThemeShapeError('The chat model’s theme had no background color. Try again.');

  const base = opaque(background);
  const surface = surfaceColor(raw.surface, base);
  const raised = surfaceColor(raw.raised, surface);
  const popover = surfaceColor(raw.popover, surface);
  const surfaces = [base, surface, raised, popover];

  return {
    background: base,
    surface,
    raised,
    popover,
    ...readableText(raw, surfaces),
    ...actionColors(raw, base),
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

function actionColors(raw: Record<string, unknown>, background: string) {
  const primary = opaque(hexColor(raw.primary) ?? readableOn(background));
  const destructive = opaque(hexColor(raw.destructive) ?? '#e5484d');

  return {
    primary,
    primaryForeground: labelOn(primary, hexColor(raw.primaryForeground)),
    destructive,
    destructiveForeground: readableOn(destructive),
    ring: ensureContrast(primary, [background], 3, readableOn(background)),
  };
}

/** The suggested label color when it reads on the button, otherwise white or black. */
function labelOn(button: string, suggested: string | undefined): string {
  if (suggested && contrast(opaque(suggested), button) >= 4.5) return opaque(suggested);

  return readableOn(button);
}
