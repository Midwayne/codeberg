import { Check } from 'lucide-react';
import { useState, type CSSProperties } from 'react';

import { applyBackdrop, loadBackdropEnabled, saveBackdropEnabled } from '../lib/backdrop';
import { FONT_STACKS, findTheme, setTheme } from '../lib/themes';
import { THEMES, type Theme, type ThemeId } from '../lib/theme-palettes';

export function AppearancePanel() {
  const [theme, selectTheme] = useState(
    () => findTheme(typeof document === 'undefined' ? undefined : document.documentElement.dataset.theme).id,
  );

  function changeTheme(id: ThemeId) {
    setTheme(id);
    selectTheme(id);
  }

  return (
    <section aria-label="Appearance" className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Appearance</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a theme. Changes apply immediately and are saved in this browser.
        </p>
      </div>
      <ThemePicker value={theme} onChange={changeTheme} />
      <BackdropToggle theme={theme} />
    </section>
  );
}

/* Turns theme scenes off for readability or focus; the colors stay. */
export function BackdropToggle({ theme }: { theme: ThemeId }) {
  const [enabled, setEnabled] = useState(loadBackdropEnabled);

  function change(next: boolean) {
    saveBackdropEnabled(next);
    applyBackdrop(findTheme(theme).backdrop, next);
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

type ThemePickerProps = { value: ThemeId; onChange: (id: ThemeId) => void };

export function ThemePicker({ value, onChange }: ThemePickerProps) {
  return (
    <fieldset>
      <legend className="mb-3 text-sm font-medium">Theme</legend>
      <div className="grid grid-cols-1 gap-4 min-[360px]:grid-cols-2 xl:grid-cols-3">
        {THEMES.map((theme) => (
          <label key={theme.id} className="cursor-pointer">
            <input
              type="radio"
              name="theme"
              value={theme.id}
              aria-label={theme.label}
              checked={value === theme.id}
              onChange={() => onChange(theme.id)}
              className="peer sr-only"
            />
            <span className="block overflow-hidden rounded-xl border border-border peer-checked:border-ring peer-checked:ring-1 peer-checked:ring-ring peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring">
              <ThemePreview theme={theme} />
              <span className="block bg-card p-3 text-card-foreground">
                <span className="flex items-center justify-between gap-2 text-sm font-medium">
                  {theme.label}
                  {value === theme.id && <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">{theme.description}</span>
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/* A miniature chat in the theme's own colors, typeface, and corner shape. */
function ThemePreview({ theme }: { theme: Theme }) {
  const { palette } = theme;
  const radius = theme.radius ?? '0.625rem';

  return (
    <span
      aria-hidden="true"
      className="relative isolate flex h-24 border-b p-3"
      style={{ backgroundColor: palette.background, borderColor: palette.border }}
    >
      {theme.backdrop && (
        <span
          className="backdrop-preview"
          data-scene={theme.backdrop}
          style={{ '--background': palette.background } as CSSProperties}
        />
      )}
      <span className="mr-3 w-5 shrink-0 rounded" style={{ backgroundColor: palette.surface }} />
      <span className="flex flex-1 flex-col justify-center gap-2">
        <span
          className="text-base leading-none"
          style={{ color: palette.foreground, fontFamily: FONT_STACKS[theme.heading ?? 'sans'] }}
        >
          Aa
        </span>
        <span className="ml-auto h-4 w-2/3" style={{ backgroundColor: palette.raised, borderRadius: radius }} />
        <span className="h-1.5 w-1/2 rounded" style={{ backgroundColor: palette.primary }} />
      </span>
    </span>
  );
}
