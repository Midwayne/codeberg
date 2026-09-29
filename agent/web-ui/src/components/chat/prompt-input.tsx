import { ArrowUp, Paperclip, Square, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { CommandMenu } from './command-menu';
import { commandQuery, matchCommands, type PromptCommand } from '@/lib/commands';
import { useCommands } from '@/lib/use-commands';
import { cn } from '@/lib/utils';
import type { CatalogModel } from '@/lib/models';

const MAX_HEIGHT = 200;
const MAX_FILE_SIZE = 20 * 1024 * 1024;

function inputFor(file: File): CatalogModel['inputs'][number] | undefined {
  if (file.type.startsWith('image/')) return 'vision';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type === 'application/pdf') return 'pdf';
  return undefined;
}

export function clipboardImages(files: FileList, inputs: readonly CatalogModel['inputs'][number][]): File[] {
  return inputs.includes('vision')
    ? Array.from(files).filter((file) => file.type.startsWith('image/'))
    : [];
}

/**
 * Auto-growing composer. Enter sends, Shift+Enter inserts a newline. The action
 * button becomes a stop control while a turn is streaming.
 *
 * Typing a leading slash opens a command autocomplete (driven by the server's
 * `/api/commands` catalog): ↑/↓ to move, Enter/Tab to accept, Esc to dismiss,
 * hover to preview what a command does. Accepting inserts the trigger so the
 * user can finish the prompt — the command itself is enhanced server-side.
 */
export function PromptInput({
  busy,
  inputs,
  onSend,
  onStop,
}: {
  busy: boolean;
  inputs: CatalogModel['inputs'];
  onSend: (text: string, files: FileList) => void;
  onStop: () => void;
}) {
  const [value, setValue] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const commands = useCommands();
  const query = commandQuery(value);
  const matches = useMemo(
    () => (query === null ? [] : matchCommands(commands, query)),
    [commands, query],
  );
  const menuOpen = !dismissed && matches.length > 0;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  // Reset the highlight whenever the set of matches changes (new query).
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    setFiles((current) => {
      const supported = current.filter((file) => {
        const input = inputFor(file);
        return input && inputs.includes(input);
      });
      return supported.length === current.length ? current : supported;
    });
  }, [inputs]);

  function submit() {
    const text = value.trim();
    if ((!text && !files.length) || busy) return;
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    onSend(text, transfer.files);
    setValue('');
    setFiles([]);
    setFileError('');
    if (fileRef.current) fileRef.current.value = '';
    setDismissed(false);
  }

  function accept(command: PromptCommand) {
    const next = `${command.trigger} `;
    setValue(next);
    setDismissed(true);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.length, next.length);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (menuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const command = matches[Math.min(activeIndex, matches.length - 1)];
        if (command) accept(command);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  const acceptedTypes = [inputs.includes('vision') && 'image/*', inputs.includes('audio') && 'audio/*',
    inputs.includes('video') && 'video/*', inputs.includes('pdf') && 'application/pdf'].filter(Boolean).join(',');

  return (
    <div className="relative rounded-2xl border border-input bg-card p-2 shadow-sm transition-colors focus-within:border-ring">
      {files.length > 0 && <div className="flex flex-wrap gap-1.5 px-2 pb-2">
        {files.map((file, index) => <span key={`${file.name}-${index}`} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs">
          {file.name}<button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles(files.filter((_, i) => i !== index))}><X className="size-3" /></button>
        </span>)}
      </div>}
      {fileError && <p role="alert" className="px-2 pb-2 text-xs text-destructive">{fileError}</p>}
      <div className="flex items-end gap-2">
      {menuOpen && (
        <CommandMenu
          commands={matches}
          activeIndex={activeIndex}
          onActivate={setActiveIndex}
          onSelect={accept}
        />
      )}
      <textarea
        ref={ref}
        rows={1}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setDismissed(false);
        }}
        onPaste={(event) => {
          const images = clipboardImages(event.clipboardData.files, inputs);
          if (!images.length || busy) return;
          event.preventDefault();
          const oversized = images.find((file) => file.size > MAX_FILE_SIZE);
          if (oversized) {
            setFileError(`Unsupported file or over 20 MB: ${oversized.name}`);
            return;
          }
          setFiles((current) => [...current, ...images]);
          setFileError('');
        }}
        onKeyDown={onKeyDown}
        placeholder="Ask about the codebase…  (type / for commands)"
        className="max-h-[200px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
      />
      {acceptedTypes && <>
        <input ref={fileRef} type="file" multiple accept={acceptedTypes} className="hidden" aria-label="Attach files" onChange={(event) => {
          const chosen = Array.from(event.target.files ?? []);
          const rejected = chosen.find((file) => {
            const input = inputFor(file);
            return !input || !inputs.includes(input) || file.size > MAX_FILE_SIZE;
          });
          if (rejected) { setFileError(`Unsupported file or over 20 MB: ${rejected.name}`); event.target.value = ''; return; }
          setFiles((current) => [...current, ...chosen]);
          setFileError('');
          event.target.value = '';
        }} />
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} aria-label="Attach files" title="Attach files" className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent disabled:opacity-30"><Paperclip className="size-4" /></button>
      </>}
      {busy ? (
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop"
          title="Stop"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Square className="size-3.5 fill-current" />
        </button>
      ) : (
        <button
          type="button"
          onClick={submit}
          disabled={!value.trim() && !files.length}
          aria-label="Send"
          title="Send"
          className={cn(
            'inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity',
            'hover:opacity-90 disabled:opacity-30',
          )}
        >
          <ArrowUp className="size-4" />
        </button>
      )}
      </div>
    </div>
  );
}
