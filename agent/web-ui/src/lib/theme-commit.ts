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

/**
 * Saves and applies a generated theme. A change to a theme that was deleted
 * while the request ran is dropped, so deleting it stays final.
 */
export function commitTheme(theme: CustomTheme, editing?: CustomTheme): boolean {
  if (editing && !isSaved(editing)) return false;

  saveCustomTheme(theme);
  changeTheme(theme.id);

  return true;
}
