import { Check } from 'lucide-react';
import { useState } from 'react';

import { findTheme, setTheme, THEMES, type ThemeId } from '@/lib/themes';

export function AppearancePanel() {
  const [theme, selectTheme] = useState(() => findTheme(document.documentElement.dataset.theme).id);

  function changeTheme(id: ThemeId) {
    setTheme(id);
    selectTheme(id);
  }

  return (
    <section aria-label="Appearance" className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Appearance</h2>
        <p className="mt-1 text-sm text-muted-foreground">Choose a theme. Changes apply immediately and are saved in this browser.</p>
      </div>
      <ThemePicker value={theme} onChange={changeTheme} />
    </section>
  );
}

export function ThemePicker({ value, onChange }: { value: ThemeId; onChange: (id: ThemeId) => void }) {
  return (
    <fieldset>
      <legend className="mb-3 text-sm font-medium">Theme</legend>
      <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 lg:grid-cols-4">
        {THEMES.map((theme) => (
          <label key={theme.id} className="cursor-pointer">
            <input type="radio" name="theme" value={theme.id} aria-label={theme.label}
              checked={value === theme.id} onChange={() => onChange(theme.id)} className="peer sr-only" />
            <span className="block overflow-hidden rounded-xl border border-border peer-checked:border-ring peer-checked:ring-1 peer-checked:ring-ring peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring">
              <span aria-hidden="true" className="flex h-24 border-b p-3" style={{ backgroundColor: theme.palette.background, borderColor: theme.palette.border }}>
                <span className="mr-3 w-5 shrink-0 rounded" style={{ backgroundColor: theme.palette.surface }} />
                <span className="flex flex-1 flex-col justify-center gap-2">
                  <span className="ml-auto h-4 w-2/3 rounded" style={{ backgroundColor: theme.palette.raised }} />
                  <span className="h-1.5 w-3/4 rounded" style={{ backgroundColor: theme.palette.foreground }} />
                  <span className="h-1.5 w-1/2 rounded" style={{ backgroundColor: theme.palette.primary }} />
                </span>
              </span>
              <span className="block bg-card p-3 text-card-foreground">
                <span className="flex items-center justify-between gap-2 text-sm font-medium">
                  {theme.label}{value === theme.id && <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />}
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
