import { applyBackdrop } from './backdrop';
import { customThemes, isCustomThemeId, subscribeOtherTabThemes } from './custom-themes';
import { DEFAULT_THEME_ID, type Theme, THEMES, type ThemeId } from './theme-palettes';
import { paletteTokens, partTokens, radiusParts, styleTokens } from './theme-tokens';
import { THEME_PARTS } from './theme-types';

export { FONT_STACKS } from './theme-fonts';

export const THEME_STORAGE_KEY = 'codeberg.theme';

/** A built-in or saved theme by id; unknown ids fall back to the default. */
export function findTheme(id: string | null | undefined): Theme & { id: ThemeId } {
  return THEMES.find((theme) => theme.id === id) ?? customThemes().find((theme) => theme.id === id) ?? THEMES[0];
}

const themeListeners = new Set<() => void>();
let activeId: ThemeId = DEFAULT_THEME_ID;

/** The applied theme's id, for components that draw per-theme content such as the backdrop. */
export function activeThemeId(): ThemeId {
  return activeId;
}

/*
 * Another tab edited or deleted the theme in use: re-apply it, so the page shows
 * the edit, or falls back to the default when it is gone.
 */
subscribeOtherTabThemes(() => {
  if (!isCustomThemeId(activeId)) return;

  const stillSaved = customThemes().some((theme) => theme.id === activeId);

  if (stillSaved) applyTheme(activeId);
  else setTheme(DEFAULT_THEME_ID);
});

export function subscribeTheme(listener: () => void): () => void {
  themeListeners.add(listener);

  return () => themeListeners.delete(listener);
}

export function loadTheme(): ThemeId {
  try {
    return findTheme(localStorage.getItem(THEME_STORAGE_KEY)).id;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function applyTheme(id: ThemeId): void {
  const theme = findTheme(id);
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.classList.toggle('dark', theme.colorScheme === 'dark');
  root.style.colorScheme = theme.colorScheme;
  applyBackdrop(theme.backdrop);
  applyTokens(root, theme);

  activeId = theme.id;
  for (const listener of themeListeners) listener();
}

/* Sets every token a theme defines and clears part radii it no longer sets. */
function applyTokens(root: HTMLElement, theme: Theme): void {
  const tokens = { ...paletteTokens(theme.palette), ...styleTokens(theme), ...partTokens(theme) };

  for (const part of THEME_PARTS) {
    if (!(`${part}-radius` in tokens)) root.style.removeProperty(`--${part}-radius`);
  }

  for (const [token, value] of Object.entries(tokens)) {
    root.style.setProperty(`--${token}`, value);
  }

  root.dataset.partRadius = radiusParts(theme);
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
