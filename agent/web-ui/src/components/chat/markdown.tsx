import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Streamdown } from 'streamdown';

import { CitationTooltip } from './citation-tooltip';
import { renderLinkConfirmation } from './link-confirmation';
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
const linkSafety = { enabled: true, renderModal: renderLinkConfirmation };

export type CitationChipProps = { citation: Citation; label: ReactNode };

function CitationChip({ citation, label }: CitationChipProps) {
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const tooltipId = useId();
  const open = hovered || focused;

  return (
    <span className="inline-block" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button
        ref={anchor}
        type="button"
        aria-label={citation.source}
        aria-describedby={open ? tooltipId : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;

          setHovered(false);
          setFocused(false);
        }}
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
      {open && (
        <CitationTooltip anchor={anchor} id={tooltipId}>
          {copied ? 'Copied!' : `${citation.path}:${citation.lines} — click to copy`}
        </CitationTooltip>
      )}
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
      linkSafety={linkSafety}
    >
      {markdown}
    </Streamdown>
  );
}
