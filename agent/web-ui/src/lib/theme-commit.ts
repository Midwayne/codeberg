import { saveCustomTheme, savedVersion, ThemeLimitError } from './custom-themes';
import { activeThemeId } from './themes';
import { changeTheme } from './theme-transition';
import type { CustomTheme } from './theme-types';

export class ThemeConflictError extends Error {
  constructor(label: string) {
    super(`${label} changed in another tab. Choose Edit on it again to change the latest version.`);
  }
}

/*
 * Whether storage still holds exactly `expected`. A save made from an older
 * snapshot would silently overwrite a version another tab saved since.
 */
function unchanged(expected: CustomTheme): boolean {
  const current = savedVersion(expected.id);

  return current !== undefined && JSON.stringify(current) === JSON.stringify(expected);
}

/**
 * Restores the version before the last change, if the theme still holds that
 * change: not after a delete, or after another tab changed it again. It is
 * shown again only if it is still the theme in use.
 */
export function restoreTheme(previous: CustomTheme, changed: CustomTheme): boolean {
  if (!unchanged(changed)) return false;

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
 * designed: a change to a deleted theme is dropped, so deleting stays final; a
 * change to a theme another tab changed since is refused, not merged over it;
 * and a theme picked in the meantime stays in use.
 */
export function commitTheme(theme: CustomTheme, { editing, activeAtStart }: CommitContext = {}): boolean {
  if (editing && !savedVersion(editing.id)) return false;

  if (editing && !unchanged(editing)) throw new ThemeConflictError(editing.label);

  try {
    saveCustomTheme(theme);
  } catch (error) {
    // Another tab filled the last slot while this was designed.
    if (error instanceof ThemeLimitError) throw new Error(`${error.message} This design could not be saved; create it again after.`);

    throw error;
  }

  if (stillWanted(editing, activeAtStart)) changeTheme(theme.id);

  return true;
}
