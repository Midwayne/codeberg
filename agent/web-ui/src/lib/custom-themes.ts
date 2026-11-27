import { normalizeTheme } from './theme-normalize';
import type { CustomTheme, CustomThemeId } from './theme-types';

export const CUSTOM_THEMES_STORAGE_KEY = 'codeberg.custom-themes';

export const MAX_CUSTOM_THEMES = 12;

const listeners = new Set<() => void>();
const otherTabListeners = new Set<() => void>();
let cache: CustomTheme[] | undefined;

export function isCustomThemeId(id: unknown): id is CustomThemeId {
  return typeof id === 'string' && /^custom-[a-z0-9-]{1,40}$/.test(id);
}

export function newCustomThemeId(): CustomThemeId {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Saved themes, newest first. Entries that no longer validate are skipped. */
export function customThemes(): CustomTheme[] {
  cache ??= readStored() ?? [];

  return cache;
}

/*
 * Writes start from what storage holds now, not this page's cache, so a theme
 * another tab saved since is kept rather than overwritten. When storage cannot
 * be read, this page's own list is all there is, so it is kept.
 */
function latest(): CustomTheme[] {
  cache = readStored() ?? cache ?? [];

  return cache;
}

export class ThemeLimitError extends Error {
  constructor() {
    super(`You have ${MAX_CUSTOM_THEMES} themes. Delete one to create another.`);
  }
}

/** Whether a new theme fits; edits always do. Checked before paying for a design. */
export function hasRoomForTheme(): boolean {
  return customThemes().length < MAX_CUSTOM_THEMES;
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

    cache = readStored() ?? cache;
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

  try {
    localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(themes));
  } catch {
    /* Themes still work for this page when browser storage is unavailable. */
  }

  for (const listener of listeners) listener();
}

/* Undefined when storage cannot be read, so callers keep what they have. */
function readStored(): CustomTheme[] | undefined {
  let text: string | null;

  try {
    text = localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY);
  } catch {
    return undefined;
  }

  // An unreadable list (say, a cut-off write) is treated like blocked storage,
  // so a later save keeps this page's themes instead of replacing it with one.
  try {
    const stored: unknown = JSON.parse(text ?? '[]');

    return Array.isArray(stored) ? stored.flatMap(restore) : undefined;
  } catch {
    return undefined;
  }
}

function restore(entry: unknown): CustomTheme[] {
  const raw = entry as Partial<CustomTheme> | null;
  if (!isCustomThemeId(raw?.id)) return [];

  try {
    const prompt = typeof raw.prompt === 'string' ? raw.prompt : '';

    return [normalizeTheme(raw, { id: raw.id, prompt, animated: true })];
  } catch {
    return [];
  }
}

/** Test hook: forget the cached list so the next read comes from storage. */
export function resetCustomThemeCache(): void {
  cache = undefined;
}
