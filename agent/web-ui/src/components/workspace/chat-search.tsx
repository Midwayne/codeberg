import { ChatSearchResults } from './chat-search-results';
import { useChatSearch } from './use-chat-search';

import type { UIMessage } from 'ai';
import { Search, X } from 'lucide-react';

import { type ChatSearchResult } from '../../lib/chat-search';

export type ChatSearchProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (id: string, messageId?: string) => void;
  currentId: string;
  currentTitle: string;
  currentMessages: readonly UIMessage[];
  currentFlags: Pick<ChatSearchResult, 'archived' | 'pinned'>;
};

export function ChatSearch(props: ChatSearchProps) {
  const state = useChatSearch(props);

  return state ? <ChatSearchView {...state} /> : null;
}

export type ChatSearchViewProps = NonNullable<ReturnType<typeof useChatSearch>>;

export function ChatSearchView(state: ChatSearchViewProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/60 px-3 pt-[min(18vh,9rem)]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) state.onClose();
      }}
    >
      <ChatSearchDialog state={state} />
    </div>
  );
}

export type ChatSearchResultButtonProps = Pick<Parameters<typeof ChatSearchResults>[0], 'state'> & {
  hit: ChatSearchResult;
  position: number;
};

export type ChatSearchInputProps = { state: Parameters<typeof ChatSearchView>[0] };

function ChatSearchInput({ state }: ChatSearchInputProps) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4">
      <Search className="size-4 shrink-0 text-muted-foreground" />
      <input
        ref={state.inputRef}
        type="text"
        inputMode="search"
        role="combobox"
        aria-label="Search chat messages"
        aria-controls="chat-search-results"
        aria-activedescendant={state.all[state.active] ? `chat-search-result-${state.active}` : undefined}
        aria-expanded={state.all.length > 0}
        value={state.query}
        onChange={(event) => {
          state.setQuery(event.target.value);
          state.setActive(0);
        }}
        placeholder="Search answers and chats…"
        className="min-w-0 flex-1 bg-transparent py-4 text-sm outline-none placeholder:text-muted-foreground"
      />
      <button
        type="button"
        onClick={state.onClose}
        aria-label="Close search"
        className="rounded p-1 text-muted-foreground hover:bg-accent"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

export type ChatSearchDialogProps = { state: Parameters<typeof ChatSearchView>[0] };

function ChatSearchDialog({ state }: ChatSearchDialogProps) {
  return (
    <section
      ref={state.dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Search chats"
      className="flex h-fit max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          state.onClose();
        }
        if (event.key === 'Tab') {
          const targets = state.dialogRef.current?.querySelectorAll<HTMLElement>('input, button');
          if (targets?.length) {
            const first = targets[0];
            const last = targets[targets.length - 1];
            if (first && last) {
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
              }
            }
          }
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          state.setActive(
            (n) => (n + (event.key === 'ArrowDown' ? 1 : -1) + state.all.length) % (state.all.length || 1),
          );
        }
        if (event.key === 'Enter' && event.target === state.inputRef.current && state.all[state.active]) {
          event.preventDefault();
          state.choose(state.all[state.active]!);
        }
      }}
    >
      <ChatSearchInput state={state} />
      <ChatSearchResults state={state} />
      <ChatSearchHelp />
    </section>
  );
}

function ChatSearchHelp() {
  return (
    <div className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
      ↑↓ Navigate · Enter Open · Esc Close
    </div>
  );
}
