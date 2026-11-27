import { CODE_STACKS, FONT_STACKS } from './theme-fonts';
import type { Palette, PartStyle, Theme, ThemePart } from './theme-types';

const DEFAULT_RADIUS = '0.625rem';

/** Shared color tokens consumed by Tailwind's theme. */
export function paletteTokens(palette: Palette): Record<string, string> {
  return {
    background: palette.background,
    foreground: palette.foreground,
    card: palette.surface,
    'card-foreground': palette.foreground,
    popover: palette.popover ?? palette.surface,
    'popover-foreground': palette.foreground,
    primary: palette.primary,
    'primary-foreground': palette.primaryForeground ?? palette.background,
    secondary: palette.raised,
    'secondary-foreground': palette.secondaryForeground ?? palette.foreground,
    muted: palette.raised,
    'muted-foreground': palette.mutedForeground,
    accent: palette.accent ?? palette.raised,
    'accent-foreground': palette.secondaryForeground ?? palette.foreground,
    destructive: palette.destructive,
    'destructive-foreground': palette.destructiveForeground ?? '#000000',
    border: palette.border,
    input: palette.input ?? palette.border,
    ring: palette.ring ?? palette.primary,
    link: palette.link ?? palette.primary,
  };
}

/** Typefaces, corner radius, and text size. */
export function styleTokens(theme: Theme): Record<string, string> {
  return {
    radius: theme.radius ?? DEFAULT_RADIUS,
    'font-body': FONT_STACKS[theme.body ?? 'sans'],
    'font-heading': FONT_STACKS[theme.heading ?? 'sans'],
    'font-code': CODE_STACKS[theme.code ?? 'mono'],
    'text-scale': String(theme.textScale ?? 1),
  };
}

/** How solid each part is over a backdrop when a theme does not say. */
export const PART_GLASS: Record<ThemePart, number> = { header: 0.72, sidebar: 0.78, composer: 0.9, bubble: 1, code: 1 };

/* What each part looks like before a theme says otherwise: today's app. */
const PART_DEFAULTS: Record<ThemePart, Required<Omit<PartStyle, 'radius'>> & { background: string }> = {
  header: { background: 'var(--background)', text: 'var(--foreground)', border: 'var(--border)', glass: PART_GLASS.header },
  sidebar: { background: 'color-mix(in srgb, var(--card) 30%, var(--background))', text: 'var(--foreground)', border: 'var(--border)', glass: PART_GLASS.sidebar },
  composer: { background: 'var(--card)', text: 'var(--foreground)', border: 'var(--input)', glass: PART_GLASS.composer },
  bubble: { background: 'var(--muted)', text: 'var(--foreground)', border: 'transparent', glass: PART_GLASS.bubble },
  code: { background: 'color-mix(in srgb, var(--background) 60%, var(--card))', text: 'var(--foreground)', border: 'var(--border)', glass: PART_GLASS.code },
};

/** Per-part colors and glass, defaulting to the palette; radii only when a theme sets them. */
export function partTokens(theme: Theme): Record<string, string> {
  const tokens: Record<string, string> = {};

  for (const [part, defaults] of Object.entries(PART_DEFAULTS) as [ThemePart, (typeof PART_DEFAULTS)[ThemePart]][]) {
    const style = theme.parts?.[part] ?? {};

    tokens[`${part}-bg`] = style.background ?? defaults.background;
    tokens[`${part}-fg`] = style.text ?? defaults.text;
    tokens[`${part}-border`] = style.border ?? defaults.border;
    tokens[`${part}-glass`] = `${Math.round((style.glass ?? defaults.glass) * 100)}%`;

    if (style.radius !== undefined) tokens[`${part}-radius`] = `${style.radius}rem`;
  }

  return tokens;
}

/** Parts whose corner radius the theme sets, for CSS to opt in to. */
export function radiusParts(theme: Theme): string {
  return Object.entries(theme.parts ?? {})
    .filter(([, style]) => style?.radius !== undefined)
    .map(([part]) => part)
    .join(' ');
}
