import { ArrowUp, CornerUpRight, ListPlus, Square } from 'lucide-react';

import type { PromptInputViewProps } from './prompt-input';

export function PromptAction({ state }: { state: PromptInputViewProps }) {
  const label = state.busy ? 'Queue follow-up' : 'Send';

  return (
    <>
      {state.busy && <button type="button" onClick={state.onStop} aria-label="Stop response" title="Stop response"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground">
        <Square aria-hidden="true" className="size-3.5 fill-current" />
      </button>}
      <button type="button" onClick={state.submit} aria-label={label} title={label}
        disabled={state.disabled || (!state.value.trim() && !state.files.length)}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-30">
        {state.busy ? <ListPlus aria-hidden="true" className="size-4" /> : <ArrowUp aria-hidden="true" className="size-4" />}
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
      className="relative inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground before:absolute before:inset-x-0 before:-inset-y-2 hover:bg-accent hover:text-foreground disabled:opacity-40">
      <CornerUpRight aria-hidden="true" className="size-3.5" />
      Steer
    </button>
  );
}
