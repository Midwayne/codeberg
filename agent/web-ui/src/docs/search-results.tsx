import { BookOpen, CornerDownLeft } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { type DocSearchHit } from './search';

export type DocsSearchResultsProps = {
  hits: DocSearchHit[];
  query: string;
  active: number;
  onActive: (index: number) => void;
  onSelect: (hit: DocSearchHit) => void;
};

export function DocsSearchResults({ hits, query, active, onActive, onSelect }: DocsSearchResultsProps) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [active, hits]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <p className="px-5 pt-4 pb-2 text-xs text-muted-foreground">{query.trim() ? 'Matching documents and sections' : 'Browse all documentation'}</p>
      <div ref={ref} id="docs-search-results" role="listbox" aria-label="Documentation results" className="px-2 pb-2">
        {hits.map((hit, index) => (
          <button key={hit.href} id={`docs-search-${index}`} type="button" role="option" tabIndex={-1}
            aria-selected={active === index} onMouseMove={() => onActive(index)} onClick={() => onSelect(hit)}
            className={`flex min-h-16 w-full items-start gap-3 rounded-lg px-3 py-3 text-left ${active === index ? 'bg-accent' : ''}`}>
            <BookOpen aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium"><SearchText text={hit.title} query={query} />{hit.section && <> <span className="text-muted-foreground">/</span> <SearchText text={hit.section} query={query} /></>}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{hit.group}</span>
              <span className="mt-1 line-clamp-2 break-words text-sm text-muted-foreground"><SearchText text={hit.snippet} query={query} /></span>
            </span>
            {active === index && <CornerDownLeft aria-hidden="true" className="mt-0.5 hidden size-4 shrink-0 text-muted-foreground sm:block" />}
          </button>
        ))}
      </div>
      {!hits.length && <p className="px-5 py-10 text-center text-sm text-muted-foreground">No documents found. Try “model”, “MCP”, or “index”.</p>}
      <span role="status" className="sr-only">{hits.length} {hits.length === 1 ? 'result' : 'results'}</span>
    </div>
  );
}

function SearchText({ text, query }: { text: string; query: string }) {
  const terms = [...new Set(query.trim().split(/\s+/).filter(Boolean))];
  if (!terms.length) return text;

  const pattern = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const pieces = text.split(new RegExp(`(${pattern})`, 'gi'));

  return pieces.map((piece, index) => index % 2
    ? <mark key={index} className="bg-transparent font-medium text-foreground">{piece}</mark>
    : piece);
}
