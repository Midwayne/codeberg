import { Search, X } from 'lucide-react';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Dialog } from '../components/dialog';
import { searchDocs, type DocSearchHit } from './search';
import { DocsSearchResults } from './search-results';
import './search.css';

export function DocsSearchDialog({ onClose, onSelect }: { onClose: () => void; onSelect: (href: string) => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => searchDocs(query), [query]);

  function choose(hit: DocSearchHit) {
    input.current?.closest('dialog')?.close();
    onClose();
    onSelect(hit.href);
  }

  function navigate(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + hits.length) % (hits.length || 1));
    }

    if (event.key === 'Enter' && hits[active]) {
      event.preventDefault();
      choose(hits[active]!);
    }
  }

  return (
    <Dialog label="Search documentation" onClose={onClose} className="docs-search-dialog w-[40rem] overflow-hidden border border-border">
      <div className="flex items-center gap-3 border-b border-border px-4">
        <Search aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
        <input ref={input} autoFocus role="combobox" aria-label="Search all documentation" aria-autocomplete="list"
          aria-controls="docs-search-results" aria-expanded="true" aria-activedescendant={hits[active] ? `docs-search-${active}` : undefined}
          value={query} onKeyDown={navigate} onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          placeholder="Search docs, settings, commands…" className="min-h-16 min-w-0 flex-1 bg-transparent text-base outline-none" />
        <button type="button" aria-label="Close search" onClick={onClose} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"><X aria-hidden="true" className="size-4" /></button>
      </div>
      <DocsSearchResults hits={hits} query={query} active={active} onActive={setActive} onSelect={choose} />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3 text-xs text-muted-foreground">
        <span>All docs · Full text</span><span>↑↓ Navigate · ↵ Open · Esc Close</span>
      </div>
    </Dialog>
  );
}
