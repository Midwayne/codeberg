import { DEFAULT_THEME_ID } from '../lib/theme-palettes';
import { useState } from 'react';

import { applyBackdrop, loadBackdropEnabled, saveBackdropEnabled } from '../lib/backdrop';
import { removeCustomTheme } from '../lib/custom-themes';
import { activeThemeId, findTheme } from '../lib/themes';
import { changeTheme } from '../lib/theme-transition';
import type { CustomThemeId } from '../lib/theme-types';
import { useActiveTheme, useCustomThemes } from '../lib/use-active-theme';
import { ThemePicker } from './theme-picker';
import { ThemeStudio } from './theme-studio';

export { ThemePicker } from './theme-picker';

export function AppearancePanel() {
  const theme = useActiveTheme();
  const custom = useCustomThemes();
  const [editingId, setEditingId] = useState<CustomThemeId>();
  const editing = custom.find((entry) => entry.id === editingId);

  function editTheme(id: CustomThemeId) {
    if (activeThemeId() !== id) changeTheme(id);

    setEditingId(id);
  }

  function deleteTheme(id: CustomThemeId) {
    if (activeThemeId() === id) changeTheme(DEFAULT_THEME_ID);
    if (editingId === id) setEditingId(undefined);

    removeCustomTheme(id);
  }

  return (
    <section aria-label="Appearance" className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Appearance</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a theme or create your own. Changes apply immediately and are saved in this browser.
        </p>
      </div>
      <ThemeStudio selected={theme} editing={editing} onDoneEditing={() => setEditingId(undefined)} />
      <ThemePicker
        value={theme.id}
        onChange={(id) => changeTheme(id)}
        custom={custom}
        onDelete={deleteTheme}
        onEdit={editTheme}
      />
      <BackdropToggle />
    </section>
  );
}

/* Turns theme scenes off for readability or focus; the colors stay. */
export function BackdropToggle() {
  const [enabled, setEnabled] = useState(loadBackdropEnabled);

  function change(next: boolean) {
    saveBackdropEnabled(next);
    applyBackdrop(findTheme(activeThemeId()).backdrop, next);
    setEnabled(next);
  }

  return (
    <label className="flex items-start gap-3 text-sm">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(event) => change(event.currentTarget.checked)}
        className="mt-0.5 size-4 accent-primary"
      />
      <span>
        <span className="font-medium">Show backdrop</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          Draw the theme's scene behind the conversation, such as stars or northern lights.
        </span>
      </span>
    </label>
  );
}
