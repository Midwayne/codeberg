import { LoaderCircle, Pencil, Sparkles } from 'lucide-react';
import { useEffect, useRef, type FormEvent } from 'react';

import { actionClass } from './button-styles';
import { useThemeStudio } from './use-theme-studio';
import type { CustomTheme, Theme } from '../lib/theme-types';

const IDEAS = ['Synthwave sunset', 'Cozy library at night', 'Deep ocean glow', 'Minimal Japanese paper'];

const EDIT_IDEAS = ['Warmer colors', 'Calmer animation', 'More contrast', 'Serif headings'];

type ThemeStudioProps = { selected: Theme; editing?: CustomTheme; onDoneEditing?: () => void };

type Studio = ReturnType<typeof useThemeStudio>;

/** Describe a theme, or a change to a saved one, and the chat model designs it. */
export function ThemeStudio({ selected, editing, onDoneEditing }: ThemeStudioProps) {
  const studio = useThemeStudio(selected, editing);
  const input = useRef<HTMLTextAreaElement>(null);

  // Choosing Edit on a card brings the studio into view, ready to type.
  useEffect(() => {
    if (!editing) return;

    input.current?.focus({ preventScroll: true });
    input.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [editing?.id]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void studio.create();
  }

  return (
    <section aria-labelledby="theme-studio-title" className="rounded-xl border border-border bg-card p-4">
      <StudioHeader editing={editing} />

      <form onSubmit={submit} className="mt-3 space-y-3">
        <textarea
          ref={input}
          aria-label={editing ? `Describe a change to ${editing.label}` : 'Describe a theme'}
          value={studio.prompt}
          onChange={(event) => studio.setPrompt(event.currentTarget.value)}
          maxLength={600}
          rows={2}
          disabled={studio.pending}
          placeholder={editing ? 'Warmer colors, slower stars, and serif headings' : 'A rainy neon city at night, with slow drifting lights'}
          className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none"
        />

        <ThemeIdeas ideas={editing ? EDIT_IDEAS : IDEAS} onPick={studio.setPrompt} disabled={studio.pending} />
        <StudioOptions studio={studio} selected={selected} editing={editing} onDoneEditing={onDoneEditing} />
        <StudioStatus studio={studio} editing={editing} />
      </form>
    </section>
  );
}

function StudioHeader({ editing }: { editing?: CustomTheme }) {
  const Icon = editing ? Pencil : Sparkles;

  return (
    <>
      <h3 id="theme-studio-title" className="flex items-center gap-2 text-sm font-medium">
        <Icon aria-hidden="true" className="size-4 text-primary" />
        {editing ? `Change ${editing.label}` : 'Create a theme'}
      </h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        {editing
          ? 'Describe what to change. Your chat model keeps the rest of the theme as it is.'
          : 'Describe a look and your chat model designs its colors, fonts, and backdrop. Each theme uses a few thousand tokens.'}
      </p>
    </>
  );
}

type ThemeIdeasProps = { ideas: string[]; onPick: (idea: string) => void; disabled: boolean };

function ThemeIdeas({ ideas, onPick, disabled }: ThemeIdeasProps) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Theme ideas">
      {ideas.map((idea) => (
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

type StudioOptionsProps = { studio: Studio; selected: Theme; editing?: CustomTheme; onDoneEditing?: () => void };

function StudioOptions({ studio, selected, editing, onDoneEditing }: StudioOptionsProps) {
  const idle = editing ? 'Apply change' : 'Create theme';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={studio.animated} onChange={(event) => studio.setAnimated(event.currentTarget.checked)} className="size-4 accent-primary" />
          Animated
        </label>
        {!editing && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={studio.refine} onChange={(event) => studio.setRefine(event.currentTarget.checked)} className="size-4 accent-primary" />
            Start from {selected.label}
          </label>
        )}
      </div>

      <div className="flex items-center gap-2">
        {studio.pending && (
          <button type="button" onClick={studio.cancel} className={actionClass}>Cancel</button>
        )}
        {editing && !studio.pending && (
          <button type="button" onClick={onDoneEditing} className={actionClass}>Done</button>
        )}
        <button type="submit" disabled={studio.pending || !studio.prompt.trim()} className={`${actionClass} inline-flex items-center gap-2 border-transparent bg-primary text-primary-foreground hover:bg-primary/90`}>
          {studio.pending && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
          {studio.pending ? 'Designing…' : idle}
        </button>
      </div>
    </div>
  );
}

function StudioStatus({ studio, editing }: { studio: Studio; editing?: CustomTheme }) {
  if (studio.error) {
    return <p role="alert" className="text-xs text-destructive">{studio.error}</p>;
  }

  if (!editing || !studio.previous) return null;

  return (
    <p aria-live="polite" className="flex items-center gap-2 text-xs text-muted-foreground">
      Changed {editing.label}. Keep describing changes, or
      <button type="button" onClick={studio.undo} className="font-medium text-foreground underline underline-offset-2">
        undo
      </button>
    </p>
  );
}
