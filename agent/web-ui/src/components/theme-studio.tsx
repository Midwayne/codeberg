import { LoaderCircle, Sparkles } from 'lucide-react';
import type { FormEvent } from 'react';

import { actionClass } from './button-styles';
import { useThemeStudio } from './use-theme-studio';
import type { Theme } from '../lib/theme-types';

const IDEAS = ['Synthwave sunset', 'Cozy library at night', 'Deep ocean glow', 'Minimal Japanese paper'];

type ThemeStudioProps = { selected: Theme };

/** Describe a theme and the chat model designs it; the result is saved and applied. */
export function ThemeStudio({ selected }: ThemeStudioProps) {
  const studio = useThemeStudio(selected);

  function submit(event: FormEvent) {
    event.preventDefault();
    void studio.create();
  }

  return (
    <section aria-labelledby="theme-studio-title" className="rounded-xl border border-border bg-card p-4">
      <h3 id="theme-studio-title" className="flex items-center gap-2 text-sm font-medium">
        <Sparkles aria-hidden="true" className="size-4 text-primary" />
        Create a theme
      </h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        Describe a look and your chat model designs its colors, fonts, and backdrop. Each theme uses a few
        thousand tokens.
      </p>

      <form onSubmit={submit} className="mt-3 space-y-3">
        <textarea
          aria-label="Describe a theme"
          value={studio.prompt}
          onChange={(event) => studio.setPrompt(event.currentTarget.value)}
          maxLength={600}
          rows={2}
          disabled={studio.pending}
          placeholder="A rainy neon city at night, with slow drifting lights"
          className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none"
        />

        <ThemeIdeas onPick={studio.setPrompt} disabled={studio.pending} />
        <StudioOptions studio={studio} selected={selected} />

        {studio.error && (
          <p role="alert" className="text-xs text-destructive">
            {studio.error}
          </p>
        )}
      </form>
    </section>
  );
}

function ThemeIdeas({ onPick, disabled }: { onPick: (idea: string) => void; disabled: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Theme ideas">
      {IDEAS.map((idea) => (
        <button
          key={idea}
          type="button"
          disabled={disabled}
          onClick={() => onPick(idea)}
          className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          {idea}
        </button>
      ))}
    </div>
  );
}

type StudioOptionsProps = { studio: ReturnType<typeof useThemeStudio>; selected: Theme };

function StudioOptions({ studio, selected }: StudioOptionsProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={studio.animated} onChange={(event) => studio.setAnimated(event.currentTarget.checked)} className="size-4 accent-primary" />
          Animated
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={studio.refine} onChange={(event) => studio.setRefine(event.currentTarget.checked)} className="size-4 accent-primary" />
          Start from {selected.label}
        </label>
      </div>

      <div className="flex items-center gap-2">
        {studio.pending && (
          <button type="button" onClick={studio.cancel} className={actionClass}>
            Cancel
          </button>
        )}
        <button type="submit" disabled={studio.pending || !studio.prompt.trim()} className={`${actionClass} inline-flex items-center gap-2 border-transparent bg-primary text-primary-foreground hover:bg-primary/90`}>
          {studio.pending && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
          {studio.pending ? 'Designing…' : 'Create theme'}
        </button>
      </div>
    </div>
  );
}
