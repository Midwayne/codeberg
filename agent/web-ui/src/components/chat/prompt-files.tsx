import { Paperclip, X } from 'lucide-react';

import { type PromptInputView } from './prompt-input';
import { inputFor, MAX_FILE_SIZE } from '../../lib/prompt-files';

export { PromptAction } from './prompt-actions';

export type PromptAttachmentsProps = { state: Parameters<typeof PromptInputView>[0] };

export function PromptAttachments({ state }: PromptAttachmentsProps) {
  return (
    state.acceptedTypes && (
      <>
        <input
          ref={state.fileRef}
          type="file"
          multiple
          accept={state.acceptedTypes}
          className="hidden"
          aria-label="Attach files"
          onChange={(event) => {
            const chosen = Array.from(event.target.files ?? []);
            const rejected = chosen.find((file) => {
              const input = inputFor(file);
              return !input || !state.inputs.includes(input) || file.size > MAX_FILE_SIZE;
            });
            if (rejected) {
              state.setFileError(`Unsupported file or over 20 MB: ${rejected.name}`);
              event.target.value = '';
              return;
            }
            state.setFiles((current) => [...current, ...chosen]);
            state.setFileError('');
            event.target.value = '';
          }}
        />
        <button
          type="button"
          disabled={state.disabled}
          onClick={() => state.fileRef.current?.click()}
          aria-label="Attach files"
          title="Attach files"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent disabled:opacity-30"
        >
          <Paperclip className="size-4" />
        </button>
      </>
    )
  );
}

export type PromptFilesProps = { state: Parameters<typeof PromptInputView>[0] };

export function PromptFiles({ state }: PromptFilesProps) {
  return (
    state.files.length > 0 && (
      <div className="flex flex-wrap gap-1.5 px-2 pb-2">
        {state.files.map((file, index) => (
          <span
            key={`${file.name}-${index}`}
            className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md bg-muted pl-2 text-xs"
          >
            <span className="truncate">{file.name}</span>
            <button
              type="button"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-accent"
              aria-label={`Remove ${file.name}`}
              onClick={() => state.setFiles(state.files.filter((_, i) => i !== index))}
            >
              <X className="size-3.5" />
            </button>
          </span>
        ))}
      </div>
    )
  );
}
