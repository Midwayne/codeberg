import type { CustomTheme } from './theme-types';

/*
 * Changes this page made while the browser refused to write them (a full quota,
 * or blocked storage). They are laid over whatever storage holds, so neither a
 * stale stored list nor another tab's write can undo them, until a write of the
 * whole list succeeds.
 */
const saved = new Map<string, CustomTheme>();
const deleted = new Set<string>();

export type ThemeChange = { save: CustomTheme } | { remove: string };

export function overlayUnsaved(themes: CustomTheme[]): CustomTheme[] {
  if (saved.size === 0 && deleted.size === 0) return themes;

  const present = new Set(themes.map((theme) => theme.id));
  const added = [...saved.values()].filter((theme) => !present.has(theme.id));
  const kept = themes.filter((theme) => !deleted.has(theme.id));

  return [...added, ...kept.map((theme) => saved.get(theme.id) ?? theme)];
}

export function recordUnsaved(change: ThemeChange): void {
  if ('save' in change) {
    saved.set(change.save.id, change.save);
    deleted.delete(change.save.id);
  } else {
    saved.delete(change.remove);
    deleted.add(change.remove);
  }
}

/** A whole list was written, so every change is in storage now. */
export function clearUnsaved(): void {
  saved.clear();
  deleted.clear();
}

/** Whether this page holds theme changes the browser has not stored. */
export function hasUnsavedThemes(): boolean {
  return saved.size > 0 || deleted.size > 0;
}
