import { CUSTOM_THEMES_STORAGE_KEY, forgetWriteFailure, readStoredThemes, resetThemeStorage, writeStoredThemes } from './custom-theme-storage';
import type { CustomTheme, CustomThemeId } from './theme-types';

export const MAX_CUSTOM_THEMES = 12;

const listeners = new Set<() => void>();
const otherTabListeners = new Set<() => void>();
let cache: CustomTheme[] | undefined;

export { isCustomThemeId, newCustomThemeId } from './custom-theme-id';

/** Saved themes, newest first. Entries that no longer validate are skipped. */
export function customThemes(): CustomTheme[] {
  cache ??= readStoredThemes() ?? [];

  return cache;
}

/*
 * Writes start from what storage holds now, not this page's cache, so a theme
 * another tab saved since is kept rather than overwritten. When storage cannot
 * be trusted (see readStoredThemes), this page's own list is kept.
 */
function latest(): CustomTheme[] {
  cache = readStoredThemes() ?? cache ?? [];

  return cache;
}

export class ThemeLimitError extends Error {
  constructor() {
    super(`You have ${MAX_CUSTOM_THEMES} themes. Delete one to create another.`);
  }
}

/** Whether a new theme fits; edits always do. Checked before paying for a design. */
export function hasRoomForTheme(): boolean {
  // Fresh from storage, so a slot another tab just filled is counted before paying.
  return latest().length < MAX_CUSTOM_THEMES;
}

/**
 * Replaces the theme with the same id in place, or adds a new one first. A new
 * theme past the limit is refused rather than deleting an older one, which may
 * be in use or being edited (possibly in another tab).
 */
export function saveCustomTheme(theme: CustomTheme): void {
  const themes = latest();

  if (themes.some((entry) => entry.id === theme.id)) {
    return write(themes.map((entry) => (entry.id === theme.id ? theme : entry)));
  }

  if (themes.length >= MAX_CUSTOM_THEMES) throw new ThemeLimitError();

  write([theme, ...themes]);
}

export function removeCustomTheme(id: CustomThemeId): void {
  write(latest().filter((entry) => entry.id !== id));
}

export function subscribeCustomThemes(listener: () => void): () => void {
  listeners.add(listener);
  watchOtherTabs();

  return () => listeners.delete(listener);
}

let watching = false;

/* Another tab saving or deleting a theme refreshes this tab's list. */
function watchOtherTabs(): void {
  if (watching || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;

  watching = true;
  window.addEventListener('storage', (event) => {
    if (event.key !== CUSTOM_THEMES_STORAGE_KEY && event.key !== null) return;

    // Another tab wrote successfully, so storage is newer even after a failed write here.
    forgetWriteFailure();
    cache = readStoredThemes() ?? cache;
    for (const listener of [...listeners, ...otherTabListeners]) listener();
  });
}

/** Called only when another tab changes the saved themes, so the active one can be re-applied. */
export function subscribeOtherTabThemes(listener: () => void): () => void {
  otherTabListeners.add(listener);
  watchOtherTabs();

  return () => otherTabListeners.delete(listener);
}

function write(themes: CustomTheme[]): void {
  cache = themes;
  writeStoredThemes(themes);

  for (const listener of listeners) listener();
}

/** Test hook: forget the cached list so the next read comes from storage. */
export function resetCustomThemeCache(): void {
  cache = undefined;
  resetThemeStorage();
}

export { CUSTOM_THEMES_STORAGE_KEY } from './custom-theme-storage';
