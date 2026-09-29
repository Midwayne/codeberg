import type { UIMessage } from 'ai';
import { MessageSquare, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { rankChatResults, searchChats, type ChatSearchResult } from '@/lib/chat-search';
import { cn } from '@/lib/utils';

export function ChatSearch({ open, onClose, onSelect, currentId, currentTitle, currentMessages, currentFlags }: {
  open: boolean;
  onClose: () => void;
  onSelect: (id: string, messageId?: string) => void;
  currentId: string;
  currentTitle: string;
  currentMessages: readonly UIMessage[];
  currentFlags: Pick<ChatSearchResult, 'archived' | 'pinned'>;
}) {
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<{ query: string; hits: ChatSearchResult[] }>({ query: '', hits: [] });
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else { setQuery(''); setRemote({ query: '', hits: [] }); setActive(0); }
  }, [open]);

  useEffect(() => {
    const term = query.trim();
    if (!open || !term) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const timer = window.setTimeout(() => {
      void searchChats(term, controller.signal)
        .then((hits) => { setRemote({ query: term, hits }); setLoading(false); })
        .catch((reason: unknown) => {
          if (controller.signal.aborted) return;
          setError(reason instanceof Error ? reason.message : 'Search failed');
          setLoading(false);
        });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, query]);

  const { current, others } = useMemo(() => rankChatResults(
    query, currentId, currentTitle, currentMessages,
    remote.query === query.trim() ? remote.hits : [],
    currentFlags,
  ), [query, currentId, currentTitle, currentMessages, remote, currentFlags]);
  const all = [...current, ...others];

  useEffect(() => {
    resultsRef.current?.querySelector(`[data-search-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, remote, query]);

  if (!open) return null;
  const choose = (item: ChatSearchResult) => {
    onSelect(item.id, item.messageId);
    onClose();
  };
  let index = 0;
  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/60 px-3 pt-[min(18vh,9rem)]" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-label="Search chats" className="flex h-fit max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl" onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); onClose(); }
        if (event.key === 'Tab') {
          const targets = dialogRef.current?.querySelectorAll<HTMLElement>('input, button');
          if (targets?.length) {
            const first = targets[0];
            const last = targets[targets.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
          }
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          setActive((n) => (n + (event.key === 'ArrowDown' ? 1 : -1) + all.length) % (all.length || 1));
        }
        if (event.key === 'Enter' && event.target === inputRef.current && all[active]) { event.preventDefault(); choose(all[active]); }
      }}>
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input ref={inputRef} type="text" inputMode="search" role="combobox" aria-label="Search chat messages" aria-controls="chat-search-results" aria-activedescendant={all[active] ? `chat-search-result-${active}` : undefined} aria-expanded={all.length > 0} value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} placeholder="Search answers and chats…" className="min-w-0 flex-1 bg-transparent py-4 text-sm outline-none placeholder:text-muted-foreground" />
          <button type="button" onClick={onClose} aria-label="Close search" className="rounded p-1 text-muted-foreground hover:bg-accent"><X className="size-4" /></button>
        </div>
        <div ref={resultsRef} id="chat-search-results" role="listbox" aria-label="Search results" className="min-h-24 overflow-y-auto p-2">
          {!query.trim() && <p className="px-3 py-6 text-center text-xs text-muted-foreground">Search answers in this chat and all other chats, including archived.</p>}
          {query.trim() && all.length === 0 && !loading && !error && <p className="px-3 py-6 text-center text-xs text-muted-foreground">No matches found.</p>}
          {error && <p role="alert" className="px-3 py-3 text-xs text-destructive">{error}</p>}
          {([
            ['Current chat', current],
            ['Other chats', others],
          ] as const).map(([label, hits]) => hits.length > 0 && (
            <div key={label}>
              <h2 className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</h2>
              {hits.map((hit) => {
                const position = index++;
                return (
                  <button key={`${hit.id}-${hit.messageId ?? 'title'}-${position}`} id={`chat-search-result-${position}`} data-search-index={position} type="button" role="option" aria-selected={active === position} onMouseEnter={() => setActive(position)} onClick={() => choose(hit)} className={cn('flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left text-sm', active === position ? 'bg-accent' : 'hover:bg-accent/60')}>
                    <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-xs font-medium"><span className="truncate">{hit.title}</span>{hit.archived && <span className="shrink-0 text-[10px] text-muted-foreground">Archived</span>}</span>
                      <span className="line-clamp-2 text-xs text-muted-foreground">{hit.role === 'title' ? 'Chat title' : hit.role === 'assistant' ? 'Answer' : 'Prompt'} · {hit.snippet}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          {loading && <p className="px-3 py-2 text-xs text-muted-foreground">Searching saved chats…</p>}
        </div>
        <div className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">↑↓ Navigate · Enter Open · Esc Close</div>
      </section>
    </div>
  );
}
