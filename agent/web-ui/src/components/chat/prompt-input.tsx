import { usePromptInput } from './use-prompt-input';
import { PromptTextarea } from './prompt-textarea';
import { PromptAttachments, PromptFiles, PromptAction } from './prompt-files';
import { PromptSteer } from './prompt-actions';

import { type RefObject } from 'react';

import { CommandMenu } from './command-menu';

import { type CatalogModel } from '../../lib/models';

export { MAX_HEIGHT, MAX_FILE_SIZE, inputFor, clipboardImages } from '../../lib/prompt-files';

/**
 * Auto-growing composer. Enter sends, Shift+Enter inserts a newline. The action
 * button queues a follow-up during a turn; Stop and Steer remain separate actions.
 *
 * Typing a leading slash opens a command autocomplete (driven by the server's
 * `/api/commands` catalog): ↑/↓ to move, Enter/Tab to accept, Esc to dismiss,
 * hover to preview what a command does. Accepting inserts the trigger so the
 * user can finish the prompt — the command itself is enhanced server-side.
 */
export type PromptInputProps = {
  value: string;
  onValueChange: (value: string) => void;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  busy: boolean;
  disabled?: boolean;
  inputs: CatalogModel['inputs'];
  onSend: (text: string, files: FileList) => void;
  onSteer?: (text: string, files: FileList) => void;
  onStop: () => void;
};

export function PromptInput(props: PromptInputProps) {
  const state = usePromptInput(props);

  return <PromptInputView {...state} />;
}

export type PromptInputViewProps = ReturnType<typeof usePromptInput>;

export function PromptInputView(state: PromptInputViewProps) {
  return (
    <div>
      <div className="relative rounded-xl border border-input bg-card p-2 transition-colors focus-within:border-ring">
        <PromptFiles state={state} />
        {state.fileError && (
          <p role="alert" className="px-2 pb-2 text-xs text-destructive">
            {state.fileError}
          </p>
        )}
        <div className="flex items-end gap-2">
          {state.menuOpen && (
            <CommandMenu
              id={state.commandId}
              commands={state.matches}
              activeIndex={state.activeIndex}
              onActivate={state.setActiveIndex}
              onSelect={state.accept}
            />
          )}
          <PromptTextarea state={state} />
          <PromptAttachments state={state} />
          <PromptAction state={state} />
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-x-2">
        <p id={state.helpId} className="text-center text-xs leading-5 text-muted-foreground">
          <span>{state.busy ? 'Enter to queue' : 'Enter to send'} · </span>
          <span className="hidden sm:inline">Shift+Enter for newline · </span>Type / for commands
        </p>
        <PromptSteer state={state} />
      </div>
    </div>
  );
}
