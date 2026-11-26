import { DEFAULT_THEME_ID } from './theme-palettes';
import { useSyncExternalStore } from 'react';

import { customThemes, subscribeCustomThemes } from './custom-themes';
import { activeThemeId, findTheme, subscribeTheme } from './themes';

/** The applied theme, updated when it changes or a saved theme is edited. */
export function useActiveTheme() {
  const id = useSyncExternalStore(subscribeTheme, activeThemeId, () => DEFAULT_THEME_ID);

  useSyncExternalStore(subscribeCustomThemes, customThemes, customThemes);

  return findTheme(id);
}

/** Saved custom themes, newest first. */
export function useCustomThemes() {
  return useSyncExternalStore(subscribeCustomThemes, customThemes, () => []);
}
