import { ChevronDown, Paperclip, X } from 'lucide-react';

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
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-foreground hover:bg-accent disabled:opacity-30"
        >
          <Paperclip aria-hidden="true" className="size-5" />
        </button>
      </>
    )
  );
}

export type PromptFilesProps = { state: Parameters<typeof PromptInputView>[0] };

export function PromptFiles({ state }: PromptFilesProps) {
  return (
    state.files.length > 0 && (
      <details className="group relative shrink-0">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-full bg-muted px-3 text-sm [&::-webkit-details-marker]:hidden">
          {state.files.length} {state.files.length === 1 ? 'file' : 'files'}
          <ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground group-open:rotate-180" />
        </summary>
        <div className="absolute bottom-full left-0 z-30 mb-3 max-h-56 w-[min(20rem,calc(100vw-3rem))] overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground">
          {state.files.map((file, index) => (
            <span
              key={`${file.name}-${index}`}
              className="flex min-w-0 items-center gap-2 rounded-lg pl-3 text-sm"
            >
              <span className="min-w-0 flex-1 truncate" title={file.name}>{file.name}</span>
              <button
                type="button"
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-accent"
                aria-label={`Remove ${file.name}`}
                onClick={() => {
                  state.setFiles(state.files.filter((_, i) => i !== index));
                  if (state.files.length === 1) state.ref?.current?.focus();
                }}
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      </details>
    )
  );
}
