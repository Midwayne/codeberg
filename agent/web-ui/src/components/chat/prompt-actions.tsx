import { ArrowRight, CornerUpRight, ListPlus, Square } from 'lucide-react';

import type { PromptInputViewProps } from './prompt-input';

export function PromptAction({ state }: { state: PromptInputViewProps }) {
  const label = state.busy ? 'Queue follow-up' : 'Send';

  return (
    <>
      {state.busy && <button type="button" onClick={state.onStop} aria-label="Stop response" title="Stop response"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground">
        <Square aria-hidden="true" className="size-3.5 fill-current" />
      </button>}
      <button type="button" onClick={state.submit} aria-label={label} title={label}
        disabled={state.disabled || (!state.value.trim() && !state.files.length)}
        className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-30">
        {state.busy ? <ListPlus aria-hidden="true" className="size-5" /> : <ArrowRight aria-hidden="true" className="size-6" />}
      </button>
    </>
  );
}

export function PromptSteer({ state }: { state: PromptInputViewProps }) {
  if (!state.busy || !state.steer) return null;

  return (
    <button type="button" onClick={state.steer} aria-label="Steer now"
      title="Stop the current response and continue with this instruction"
      disabled={state.disabled || (!state.value.trim() && !state.files.length)}
      className="relative inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground before:absolute before:inset-x-0 before:-inset-y-2 hover:bg-accent hover:text-foreground disabled:opacity-40 max-[359px]:min-w-11 max-[359px]:justify-center">
      <CornerUpRight aria-hidden="true" className="size-3.5" />
      <span className="hidden min-[360px]:inline">Steer</span>
    </button>
  );
}
