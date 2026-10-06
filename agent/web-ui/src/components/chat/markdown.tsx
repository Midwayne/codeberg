import { useMemo, useState, type ReactNode } from 'react';
import { Streamdown } from 'streamdown';

import { CITE_TAG, parseCiteSource, type Citation } from '../../lib/citations';
import { transformCitations } from '../../lib/citations';

/**
 * The markdown engine behind <Response>, plus citation rendering. This module
 * statically imports streamdown (shiki + mermaid — the bulk of the bundle), so
 * it must only ever be loaded via response.tsx's lazy() to keep the app shell
 * small.
 *
 * Agent citations (`[path:12-40]`) are rewritten to numbered `<cite-chip>`
 * tags before rendering (see lib/citations.ts) and drawn as small chips that
 * show the full source on hover and copy it on click — the paths themselves
 * stay out of the prose. `allowedTags`/`literalTagContent` let the tag through
 * streamdown's sanitizer with its children treated as a plain label.
 */

const allowedTags = { [CITE_TAG]: ['source'] };
const literalTagContent = [CITE_TAG];

export type CiteChipTagProps = { source?: unknown; children?: ReactNode };

function CiteChipTag({ source, children }: CiteChipTagProps) {
  const citation = typeof source === 'string' ? parseCiteSource(source) : null;
  if (!citation) {
    return null;
  }
  return <CitationChip citation={citation} label={children} />;
}

const components = { [CITE_TAG]: CiteChipTag };

export type CitationChipProps = { citation: Citation; label: ReactNode };

function CitationChip({ citation, label }: CitationChipProps) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="group/cite relative inline-block">
      <button
        type="button"
        aria-label={citation.source}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(citation.source);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          } catch {
            /* clipboard unavailable */
          }
        }}
        className="mx-px inline-flex min-w-4 cursor-pointer items-center justify-center rounded-full bg-muted px-1 align-super font-mono text-[10px] leading-4 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {label}
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-0 z-50 mb-1.5 hidden w-max max-w-80 rounded-md border border-border bg-popover px-2 py-1 font-mono text-[11px] leading-snug break-all text-popover-foreground shadow-md group-hover/cite:block group-focus-within/cite:block"
      >
        {copied ? 'Copied!' : `${citation.path}:${citation.lines} — click to copy`}
      </span>
    </span>
  );
}

export type MarkdownProps = { children: string; className?: string };

export default function Markdown({ children, className }: MarkdownProps) {
  const markdown = useMemo(() => transformCitations(children), [children]);
  return (
    <Streamdown
      className={className}
      components={components}
      allowedTags={allowedTags}
      literalTagContent={literalTagContent}
    >
      {markdown}
    </Streamdown>
  );
}
