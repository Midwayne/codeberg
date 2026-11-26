import { normalizeTheme } from './theme-normalize';
import type { CustomTheme, CustomThemeId } from './theme-types';

export const CUSTOM_THEMES_STORAGE_KEY = 'codeberg.custom-themes';

export const MAX_CUSTOM_THEMES = 12;

const listeners = new Set<() => void>();
let cache: CustomTheme[] | undefined;

export function isCustomThemeId(id: unknown): id is CustomThemeId {
  return typeof id === 'string' && /^custom-[a-z0-9-]{1,40}$/.test(id);
}

export function newCustomThemeId(): CustomThemeId {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Saved themes, newest first. Entries that no longer validate are skipped. */
export function customThemes(): CustomTheme[] {
  cache ??= readStored();

  return cache;
}

/** Adds a theme, or replaces the one with the same id, keeping the newest twelve. */
export function saveCustomTheme(theme: CustomTheme): void {
  const others = customThemes().filter((entry) => entry.id !== theme.id);

  write([theme, ...others].slice(0, MAX_CUSTOM_THEMES));
}

export function removeCustomTheme(id: CustomThemeId): void {
  write(customThemes().filter((entry) => entry.id !== id));
}

export function subscribeCustomThemes(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
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

function readStored(): CustomTheme[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY) ?? '[]');

    return Array.isArray(stored) ? stored.flatMap(restore) : [];
  } catch {
    return [];
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
