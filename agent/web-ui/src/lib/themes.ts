import { applyBackdrop } from './backdrop';
import { type Palette, type Theme, type ThemeFont, THEMES, type ThemeId } from './theme-palettes';

export const THEME_STORAGE_KEY = 'codeberg.theme';

export const FONT_STACKS: Record<ThemeFont, string> = {
  sans: 'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
  serif: 'ui-serif, "Iowan Old Style", "Palatino Linotype", Georgia, Cambria, serif',
  mono: 'ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
};

const DEFAULT_RADIUS = '0.625rem';

export function findTheme(id: string | null | undefined): Theme & { id: ThemeId } {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

function styleTokens(theme: Theme) {
  return {
    radius: theme.radius ?? DEFAULT_RADIUS,
    'font-body': FONT_STACKS[theme.body ?? 'sans'],
    'font-heading': FONT_STACKS[theme.heading ?? 'sans'],
  };
}

export function loadTheme(): ThemeId {
  try {
    return findTheme(localStorage.getItem(THEME_STORAGE_KEY)).id;
  } catch {
    return 'dark';
  }
}

function themeTokens(palette: Palette) {
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
  };
}

export function applyTheme(id: ThemeId): void {
  const theme = findTheme(id);
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.classList.toggle('dark', theme.colorScheme === 'dark');
  root.style.colorScheme = theme.colorScheme;
  applyBackdrop(theme.backdrop);

  const tokens = { ...themeTokens(theme.palette), ...styleTokens(theme) };

  for (const [token, value] of Object.entries(tokens)) {
    root.style.setProperty(`--${token}`, value);
  }
}

export function setTheme(id: ThemeId): void {
  applyTheme(id);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    /* Keep the active theme usable when browser storage is unavailable. */
  }
}

export { THEMES } from './theme-palettes';
