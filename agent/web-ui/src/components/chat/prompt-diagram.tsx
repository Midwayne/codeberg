import { Workflow } from 'lucide-react';

import type { PromptInputViewProps } from './prompt-input';

/**
 * Ask for a diagram with this message. Only then does the agent get the
 * canvas tools and drawing instructions, so other messages cost fewer tokens.
 */
export function PromptDiagram({ state }: { state: PromptInputViewProps }) {
  if (!state.diagrams) return null;

  const label = state.diagram ? 'Diagram on for this message' : 'Draw a diagram with this message';

  return (
    <button
      type="button"
      disabled={state.disabled}
      onClick={() => state.setDiagram(!state.diagram)}
      aria-pressed={state.diagram}
      aria-label={label}
      title={label}
      className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 aria-pressed:bg-accent aria-pressed:text-foreground"
    >
      <Workflow aria-hidden="true" className="size-5" />
      <span className="hidden min-[360px]:inline">Diagram</span>
    </button>
  );
}
