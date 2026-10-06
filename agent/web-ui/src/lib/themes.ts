import { type Palette, THEMES, type ThemeId } from './theme-palettes';

export const THEME_STORAGE_KEY = 'codeberg.theme';

export function findTheme(id: string | null | undefined) {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
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
    popover: palette.surface,
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
  for (const [token, value] of Object.entries(themeTokens(theme.palette))) {
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

export type { ThemeId } from './theme-palettes';
