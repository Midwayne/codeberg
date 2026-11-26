import { Check, Pencil, Trash2 } from 'lucide-react';
import type { CSSProperties } from 'react';

import { CustomBackdropLayers } from './custom-backdrop';
import { FONT_STACKS } from '../lib/themes';
import { THEMES, type ThemeId } from '../lib/theme-palettes';
import type { CustomTheme, CustomThemeId, Theme } from '../lib/theme-types';

type ThemePickerProps = {
  value: ThemeId;
  onChange: (id: ThemeId) => void;
  custom?: CustomTheme[];
  onDelete?: (id: CustomThemeId) => void;
  onEdit?: (id: CustomThemeId) => void;
};

/** One native radio group across saved and built-in themes. */
export function ThemePicker({ value, onChange, custom = [], onDelete, onEdit }: ThemePickerProps) {
  return (
    <fieldset className="space-y-5">
      <legend className="mb-3 text-sm font-medium">Theme</legend>

      {custom.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Your themes</p>
          <ThemeGrid themes={custom} value={value} onChange={onChange} onDelete={onDelete} onEdit={onEdit} />
        </div>
      )}

      <ThemeGrid themes={THEMES} value={value} onChange={onChange} />
    </fieldset>
  );
}

type ThemeGridProps = Omit<ThemePickerProps, 'custom'> & { themes: readonly Theme[] };

function ThemeGrid({ themes, value, onChange, onDelete, onEdit }: ThemeGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 min-[360px]:grid-cols-2 xl:grid-cols-3">
      {themes.map((theme) => (
        <div key={theme.id} className="relative">
          <ThemeCard theme={theme} checked={value === theme.id} onChange={onChange} />
          {(onEdit || onDelete) && (
            <SavedThemeActions id={theme.id as CustomThemeId} label={theme.label} onEdit={onEdit} onDelete={onDelete} />
          )}
        </div>
      ))}
    </div>
  );
}

const actionButton = 'rounded-md bg-background/80 p-1.5 text-muted-foreground backdrop-blur transition-colors';

type SavedThemeActionsProps = Pick<ThemePickerProps, 'onEdit' | 'onDelete'> & { id: CustomThemeId; label: string };

/* Edit and delete sit beside the radio, not inside its label, so each stays its own control. */
function SavedThemeActions({ id, label, onEdit, onDelete }: SavedThemeActionsProps) {
  return (
    <div className="absolute top-2 right-2 flex gap-1">
      {onEdit && (
        <button type="button" aria-label={`Edit ${label}`} onClick={() => onEdit(id)} className={`${actionButton} hover:text-foreground`}>
          <Pencil aria-hidden="true" className="size-3.5" />
        </button>
      )}
      {onDelete && (
        <button type="button" aria-label={`Delete ${label}`} onClick={() => onDelete(id)} className={`${actionButton} hover:text-destructive`}>
          <Trash2 aria-hidden="true" className="size-3.5" />
        </button>
      )}
    </div>
  );
}

type ThemeCardProps = { theme: Theme; checked: boolean; onChange: (id: ThemeId) => void };

function ThemeCard({ theme, checked, onChange }: ThemeCardProps) {
  return (
    <label className="block cursor-pointer">
      <input
        type="radio"
        name="theme"
        value={theme.id}
        aria-label={theme.label}
        checked={checked}
        onChange={() => onChange(theme.id as ThemeId)}
        className="peer sr-only"
      />
      <span className="block overflow-hidden rounded-xl border border-border transition-transform peer-checked:border-ring peer-checked:ring-1 peer-checked:ring-ring peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring hover:-translate-y-0.5">
        <ThemePreview theme={theme} />
        <span className="block bg-card p-3 text-card-foreground">
          <span className="flex items-center justify-between gap-2 text-sm font-medium">
            <span className="truncate">{theme.label}</span>
            {checked && <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />}
          </span>
          <span className="mt-1 block truncate text-xs text-muted-foreground">{theme.description}</span>
        </span>
      </span>
    </label>
  );
}

/* A miniature chat in the theme's own colors, typeface, corner shape, and backdrop. */
function ThemePreview({ theme }: { theme: Theme }) {
  const { palette, backdrop } = theme;
  const radius = theme.radius ?? '0.625rem';

  return (
    <span
      aria-hidden="true"
      className="relative isolate flex h-24 border-b p-3"
      style={{ backgroundColor: palette.background, borderColor: palette.border }}
    >
      {backdrop && (
        <span
          className="backdrop-preview"
          data-scene={typeof backdrop === 'string' ? backdrop : undefined}
          style={{ '--background': palette.background } as CSSProperties}
        >
          {typeof backdrop === 'object' && <CustomBackdropLayers backdrop={backdrop} />}
        </span>
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
