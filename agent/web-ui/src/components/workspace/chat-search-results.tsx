import { MessageSquare } from 'lucide-react';

import { cn } from '../../lib/utils';
import { type ChatSearchView, type ChatSearchResultButtonProps } from './chat-search';

export type ChatSearchResultsProps = { state: Parameters<typeof ChatSearchView>[0] };

export function ChatSearchResults({ state }: ChatSearchResultsProps) {
  let index = 0;

  return (
    <div
      ref={state.resultsRef}
      id="chat-search-results"
      role="listbox"
      aria-label="Search results"
      className="min-h-24 overflow-y-auto p-2"
    >
      <ChatSearchEmptyQuery state={state} />
      {state.query.trim() && state.all.length === 0 && !state.loading && !state.error && (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">No matches found.</p>
      )}
      {state.error && (
        <p role="alert" className="px-3 py-3 text-xs text-destructive">
          {state.error}
        </p>
      )}
      {(
        [
          ['Current chat', state.current],
          ['Other chats', state.others],
        ] as const
      ).map(
        ([label, hits]) =>
          hits.length > 0 && (
            <div key={label}>
              <h2 className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {label}
              </h2>
              {hits.map((hit) => {
                const position = index++;
                return (
                  <ChatSearchResultButton
                    key={`${hit.id}-${hit.messageId ?? 'title'}-${position}`}
                    hit={hit}
                    position={position}
                    state={state}
                  />
                );
              })}
            </div>
          ),
      )}
      {state.loading && <p className="px-3 py-2 text-xs text-muted-foreground">Searching saved chats…</p>}
    </div>
  );
}

export function ChatSearchResultButton({ hit, position, state }: ChatSearchResultButtonProps) {
  return (
    <button
      key={`${hit.id}-${hit.messageId ?? 'title'}-${position}`}
      id={`chat-search-result-${position}`}
      data-search-index={position}
      type="button"
      role="option"
      aria-selected={state.active === position}
      onMouseEnter={() => state.setActive(position)}
      onClick={() => state.choose(hit)}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left text-sm',
        state.active === position ? 'bg-accent' : 'hover:bg-accent/60',
      )}
    >
      <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-xs font-medium">
          <span className="truncate">{hit.title}</span>
          {hit.archived && <span className="shrink-0 text-[10px] text-muted-foreground">Archived</span>}
        </span>
        <span className="line-clamp-2 text-xs text-muted-foreground">
          {hit.role === 'title' ? 'Chat title' : hit.role === 'assistant' ? 'Answer' : 'Prompt'} · {hit.snippet}
        </span>
      </span>
    </button>
  );
}

export type ChatSearchEmptyQueryProps = Pick<Parameters<typeof ChatSearchResults>[0], 'state'>;

function ChatSearchEmptyQuery({ state }: ChatSearchEmptyQueryProps) {
  return (
    !state.query.trim() && (
      <p className="px-3 py-6 text-center text-xs text-muted-foreground">
        Search answers in this chat and all other chats, including archived.
      </p>
    )
  );
}
