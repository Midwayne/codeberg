import { isCustomThemeId } from './custom-theme-id';
import { normalizeTheme } from './theme-normalize';
import type { CustomTheme } from './theme-types';

export const CUSTOM_THEMES_STORAGE_KEY = 'codeberg.custom-themes';

/* Saved entries this version cannot use, written back untouched so they are never lost. */
let unrestorable: unknown[] = [];

/** The saved themes, or undefined when storage is blocked or its value is unreadable. */
export function readStoredThemes(): CustomTheme[] | undefined {
  const text = storedText();
  if (text === undefined) return undefined;

  const stored = parse(text);
  if (!Array.isArray(stored)) return undefined;

  const themes: CustomTheme[] = [];
  unrestorable = [];

  for (const entry of stored) {
    const theme = restore(entry);

    if (theme) themes.push(theme);
    else unrestorable.push(entry);
  }

  return themes;
}

/** Whether the browser stored the list; false for a full quota or blocked storage. */
export function writeStoredThemes(themes: CustomTheme[]): boolean {
  try {
    localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify([...themes, ...unrestorable]));

    return true;
  } catch {
    return false;
  }
}

function storedText(): string | undefined {
  try {
    return localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY) ?? '[]';
  } catch {
    return undefined;
  }
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function restore(entry: unknown): CustomTheme | undefined {
  const raw = entry as Partial<CustomTheme> | null;
  if (!isCustomThemeId(raw?.id)) return undefined;

  try {
    const prompt = typeof raw.prompt === 'string' ? raw.prompt : '';

    return normalizeTheme(raw, { id: raw.id, prompt, animated: true });
  } catch {
    return undefined;
  }
}

/** Test hook: forget unreadable entries. */
export function resetThemeStorage(): void {
  unrestorable = [];
}
