import { isCustomThemeId } from './custom-theme-id';
import { normalizeTheme } from './theme-normalize';
import type { CustomTheme } from './theme-types';

export const CUSTOM_THEMES_STORAGE_KEY = 'codeberg.custom-themes';

/** Where an unreadable saved value is kept before it is replaced. */
export const BACKUP_KEY = 'codeberg.custom-themes.backup';

/* Saved entries this version cannot use, written back untouched so they are never lost. */
let unrestorable: unknown[] = [];

/** The saved themes, or undefined when storage is blocked or its value is unreadable. */
export function readStoredThemes(): CustomTheme[] | undefined {
  const text = storedText();
  if (text === undefined) return undefined;

  const stored = parse(text);

  if (!Array.isArray(stored)) {
    backUp(text);

    return undefined;
  }

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
  if (store([...themes, ...unrestorable])) return true;

  // Out of room: this version's themes matter more than entries it cannot show or delete.
  if (unrestorable.length === 0 || !store(themes)) return false;

  unrestorable = [];

  return true;
}

function store(entries: unknown[]): boolean {
  try {
    localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(entries));

    return true;
  } catch {
    return false;
  }
}

/* A stored value this version cannot read is copied aside once before any write replaces it. */
function backUp(text: string): void {
  try {
    if (localStorage.getItem(BACKUP_KEY) === null) localStorage.setItem(BACKUP_KEY, text);
  } catch {
    // Nothing more can be kept when storage refuses.
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
