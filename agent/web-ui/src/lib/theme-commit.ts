import { customThemes, saveCustomTheme } from './custom-themes';
import { activeThemeId } from './themes';
import { changeTheme } from './theme-transition';
import type { CustomTheme } from './theme-types';

function isSaved(theme: CustomTheme): boolean {
  return customThemes().some((entry) => entry.id === theme.id);
}

/**
 * Restores an earlier version of a saved theme, unless it was deleted since. It
 * is shown again only if it is still the theme in use; picking another theme
 * in the meantime is respected.
 */
export function restoreTheme(previous: CustomTheme): boolean {
  if (!isSaved(previous)) return false;

  saveCustomTheme(previous);
  if (activeThemeId() === previous.id) changeTheme(previous.id);

  return true;
}

type CommitContext = { editing?: CustomTheme; activeAtStart?: string };

/* An edit shows if its theme is still in use; a new theme if nothing else was picked meanwhile. */
function stillWanted(editing: CustomTheme | undefined, activeAtStart: string | undefined): boolean {
  const active = activeThemeId();

  if (editing) return active === editing.id;

  return activeAtStart === undefined || active === activeAtStart;
}

/**
 * Saves a generated theme and shows it, unless the user moved on while it was
 * designed: a change to a deleted theme is dropped, so deleting stays final,
 * and a theme picked in the meantime stays in use.
 */
export function commitTheme(theme: CustomTheme, { editing, activeAtStart }: CommitContext = {}): boolean {
  if (editing && !isSaved(editing)) return false;

  saveCustomTheme(theme);

  if (stillWanted(editing, activeAtStart)) changeTheme(theme.id);

  return true;
}
