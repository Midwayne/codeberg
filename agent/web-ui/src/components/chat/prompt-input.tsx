import { usePromptInput } from './use-prompt-input';
import { PromptTextarea } from './prompt-textarea';
import { PromptAttachments, PromptFiles, PromptAction } from './prompt-files';
import { PromptSteer } from './prompt-actions';
import { PromptFilePreviews } from './prompt-file-previews';

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
      <PromptFilePreviews files={state.files} />
      <div className="relative rounded-[1.75rem] border border-input bg-card px-4 py-2 transition-colors focus-within:border-ring sm:rounded-[2rem] sm:px-5 sm:py-3">
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
          </div>
          <div className="flex items-center gap-2">
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
