import { Workflow } from 'lucide-react';

import type { PromptInputViewProps } from './prompt-input';

/**
 * Ask for a diagram with this message. Only then does the agent get the
 * canvas tools and drawing instructions, so other messages cost fewer tokens.
 */
export function PromptDiagram({ state }: { state: PromptInputViewProps }) {
  if (!state.diagrams) return null;

  return (
    <button
      type="button"
      disabled={state.disabled}
      onClick={() => state.setDiagram(!state.diagram)}
      aria-pressed={state.diagram}
      aria-label="Diagram"
      title="Diagram"
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 aria-pressed:bg-accent aria-pressed:text-foreground"
    >
      <Workflow aria-hidden="true" className="size-5" />
    </button>
  );
}
