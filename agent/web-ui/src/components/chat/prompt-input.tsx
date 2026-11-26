import { usePromptInput, type PromptInputOptions } from './use-prompt-input';
import { PromptTextarea } from './prompt-textarea';
import { PromptAttachments, PromptFiles, PromptAction } from './prompt-files';
import { PromptSteer } from './prompt-actions';
import { PromptDiagram } from './prompt-diagram';
import { PromptFilePreviews } from './prompt-file-previews';

import { CommandMenu } from './command-menu';
import type { ReactNode } from 'react';

export { clipboardImages } from '../../lib/prompt-files';

/**
 * Auto-growing composer. Enter sends, Shift+Enter inserts a newline. The action
 * button queues a follow-up during a turn; Stop and Steer remain separate actions.
 *
 * Typing a leading slash opens a command autocomplete (driven by the server's
 * `/api/commands` catalog): ↑/↓ to move, Enter/Tab to accept, Esc to dismiss,
 * hover to preview what a command does. Accepting inserts the trigger so the
 * user can finish the prompt — the command itself is enhanced server-side.
 */
type PromptInputProps = PromptInputOptions & {
  /** Extra control beside the send actions, such as the context meter. */
  accessory?: ReactNode;
};

export function PromptInput({ accessory, ...props }: PromptInputProps) {
  const state = usePromptInput(props);

  return <PromptInputView {...state} accessory={accessory} />;
}

export type PromptInputViewProps = ReturnType<typeof usePromptInput> & { accessory?: ReactNode };

export function PromptInputView(state: PromptInputViewProps) {
  return (
    <div>
      <PromptFilePreviews files={state.files} />
      <div className="relative rounded-[1.75rem] border border-input bg-card px-4 py-2 shadow-sm transition-colors focus-within:border-ring sm:rounded-[2rem] sm:px-5 sm:py-3 md:rounded-2xl md:px-3 md:py-2">
        {state.fileError && (
          <p role="alert" className="px-2 pb-2 text-xs text-destructive">
            {state.fileError}
          </p>
        )}
        <div className="flex items-start gap-3">
          {state.menuOpen && (
            <CommandMenu
              id={state.commandId}
              commands={state.matches}
              activeIndex={state.activeIndex}
              onActivate={state.setActiveIndex}
              onSelect={state.accept}
            />
          )}
          <PromptFiles state={state} />
          <PromptTextarea state={state} />
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="flex items-center">
            <PromptAttachments state={state} />
            <PromptDiagram state={state} />
          </div>
          <div className="flex items-center gap-2">
            {state.accessory}
            <PromptSteer state={state} />
            <PromptAction state={state} />
          </div>
        </div>
      </div>
      <p id={state.helpId} className="sr-only">
        <span>{state.busy ? 'Enter to queue' : 'Enter to send'} · </span>
        <span className="hidden sm:inline">Shift+Enter for newline · </span>Type / for commands
      </p>
    </div>
  );
}
