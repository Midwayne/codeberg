import { customThemes, saveCustomTheme } from './custom-themes';
import { changeTheme } from './theme-transition';
import type { CustomTheme } from './theme-types';

/**
 * Saves and applies a generated theme. A change to a theme that was deleted
 * while the request ran is dropped, so deleting it stays final.
 */
export function commitTheme(theme: CustomTheme, editing?: CustomTheme): boolean {
  if (editing && !customThemes().some((entry) => entry.id === editing.id)) return false;

  saveCustomTheme(theme);
  changeTheme(theme.id);

  return true;
}
