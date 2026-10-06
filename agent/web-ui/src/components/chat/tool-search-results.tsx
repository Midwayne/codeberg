import { FileCode, FileSearch, GitBranch, Search } from 'lucide-react';

import { type ToolView } from './message';

import {
  extractFindReferences,
  extractGraphHops,
  extractGrepMatches,
  extractHybridHits,
  extractSearchHits,
} from '@agent/core/evidence-extract.js';
import { normalizeSearchHit } from '@agent/core/search-hit.js';

import {
  type SearchResultsProps,
  type HybridSearchResultsProps,
  type ChunkHitsProps,
  type ChunkDetailProps,
  type GrepResultsProps,
  type FindReferencesResultsProps,
  type TracePathResultsProps,
} from './tool-views';
import { HitList } from './tool-source-cards';
import { GenericTool } from './tool-status';

export function SearchResults({ part }: SearchResultsProps) {
  const query = inputQuery(part);
  const hits = extractSearchHits(part.output);
  return (
    <HitList
      icon={<Search className="size-3.5" />}
      title={`${hits.length} result${hits.length === 1 ? '' : 's'}${query ? ` for “${query}”` : ''}`}
      hits={hits}
    />
  );
}

export function HybridSearchResults({ part }: HybridSearchResultsProps) {
  const query = inputQuery(part);
  const hits = extractHybridHits(part.output);
  return (
    <HitList
      icon={<FileSearch className="size-3.5" />}
      title={`${hits.length} hybrid result${hits.length === 1 ? '' : 's'}${query ? ` for “${query}”` : ''}`}
      hits={hits}
    />
  );
}

export function ChunkHits({ title, part }: ChunkHitsProps) {
  const hits = extractSearchHits(part.output);
  return (
    <HitList
      icon={<FileCode className="size-3.5" />}
      title={`${hits.length} ${title.toLowerCase()} hit${hits.length === 1 ? '' : 's'}`}
      hits={hits}
    />
  );
}

export function ChunkDetail({ part }: ChunkDetailProps) {
  const hit = normalizeSearchHit(part.output);
  if (!hit) return <GenericTool part={part} name="get_chunk" />;
  const body =
    typeof (part.output as { body?: string })?.body === 'string' ? (part.output as { body: string }).body : hit.snippet;
  return <HitList icon={<FileCode className="size-3.5" />} title="Chunk" hits={[{ ...hit, snippet: body }]} />;
}

export function GrepResults({ title, part }: GrepResultsProps) {
  const hits = extractGrepMatches(part.output);
  const pattern =
    part.input && typeof part.input === 'object'
      ? ((part.input as { pattern?: string; symbol?: string }).pattern ?? (part.input as { symbol?: string }).symbol)
      : undefined;

  return (
    <HitList
      icon={<Search className="size-3.5" />}
      title={`${hits.length} ${title.toLowerCase()} match${hits.length === 1 ? '' : 's'}${pattern ? ` for “${pattern}”` : ''}`}
      hits={hits}
    />
  );
}

export function FindReferencesResults({ part }: FindReferencesResultsProps) {
  const hits = extractFindReferences(part.output);
  const source =
    part.output && typeof part.output === 'object' && 'source' in part.output
      ? String((part.output as { source?: string }).source ?? '')
      : '';
  const symbol = part.input && typeof part.input === 'object' ? (part.input as { symbol?: string }).symbol : undefined;
  const label = source === 'graph' ? 'graph refs' : 'grep refs';

  return (
    <HitList
      icon={<Search className="size-3.5" />}
      title={`${hits.length} ${label}${symbol ? ` for “${symbol}”` : ''}`}
      hits={hits}
    />
  );
}

export function TracePathResults({ part }: TracePathResultsProps) {
  const hits = extractGraphHops(part.output);
  const name = part.input && typeof part.input === 'object' ? (part.input as { name?: string }).name : undefined;

  return (
    <HitList
      icon={<GitBranch className="size-3.5" />}
      title={`${hits.length} hop${hits.length === 1 ? '' : 's'}${name ? ` from “${name}”` : ''}`}
      hits={hits}
    />
  );
}

export function inputQuery(part: ToolView): string | undefined {
  return part.input && typeof part.input === 'object' ? (part.input as { query?: string }).query : undefined;
}
