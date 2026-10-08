import { type PromptInputView } from './prompt-input';
import { clipboardImages, MAX_FILE_SIZE } from '../../lib/prompt-files';

export type PromptTextareaProps = { state: Parameters<typeof PromptInputView>[0] };

export function PromptTextarea({ state }: PromptTextareaProps) {
  return (
    <textarea
      ref={state.ref}
      aria-label="Message"
      aria-describedby={state.helpId}
      aria-autocomplete="list"
      aria-controls={state.menuOpen ? state.commandId : undefined}
      aria-activedescendant={
        state.menuOpen ? `${state.commandId}-${Math.min(state.activeIndex, state.matches.length - 1)}` : undefined
      }
      rows={1}
      value={state.value}
      onChange={(e) => {
        state.setValue(e.target.value);
        state.setDismissed(false);
      }}
      onPaste={(event) => {
        const images = clipboardImages(event.clipboardData.files, state.inputs);
        if (!images.length || state.disabled) return;
        event.preventDefault();
        const oversized = images.find((file) => file.size > MAX_FILE_SIZE);
        if (oversized) {
          state.setFileError(`Unsupported file or over 20 MB: ${oversized.name}`);
          return;
        }
        state.setFiles((current) => [...current, ...images]);
        state.setFileError('');
      }}
      onKeyDown={state.onKeyDown}
      disabled={state.disabled}
      placeholder={state.busy ? 'Add a follow-up or steer the response…' : 'Ask about the codebase…'}
      className="max-h-[200px] min-h-8 min-w-0 flex-1 resize-none bg-transparent px-1 py-1 text-base leading-6 outline-none placeholder:text-muted-foreground placeholder:italic"
    />
  );
}
