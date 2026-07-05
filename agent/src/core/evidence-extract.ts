import { normalizeSearchHit } from './search-hit.js';
import type { SearchResult } from './types.js';

/** Max citeable rows per tool — avoids flooding CLI sources from bulk grep/outline. */
const EVIDENCE_LIMITS: Partial<Record<string, number>> = {
  grep: 20,
  find_references: 20,
  file_outline: 32,
};

/** Pull citeable code locations from a daemon tool result for sources/ledger. */
export function extractEvidence(toolName: string, output: unknown): SearchResult[] {
  let hits: SearchResult[];
  switch (toolName) {
    case 'hybrid_search':
      hits = extractHybridHits(output);
      break;
    case 'find_symbol':
    case 'file_outline':
      hits = extractSearchHits(output);
      break;
    case 'get_chunk':
      hits = extractChunkDetail(output);
      break;
    case 'grep':
    case 'find_references':
      hits = extractGrepMatches(output);
      break;
    default:
      return [];
  }
  const limit = EVIDENCE_LIMITS[toolName];
  if (limit != null && hits.length > limit) {
    return hits.slice(0, limit);
  }
  return hits;
}

function extractHybridHits(output: unknown): SearchResult[] {
  if (!Array.isArray(output)) {
    return [];
  }
  return output
    .map((row) => {
      if (!row || typeof row !== 'object' || !('hit' in row)) {
        return null;
      }
      return normalizeSearchHit((row as { hit: unknown }).hit);
    })
    .filter((h): h is SearchResult => h != null);
}

function extractSearchHits(output: unknown): SearchResult[] {
  if (!Array.isArray(output)) {
    return [];
  }
  return output.map(normalizeSearchHit).filter((h): h is SearchResult => h != null);
}

function extractChunkDetail(output: unknown): SearchResult[] {
  const hit = normalizeSearchHit(output);
  return hit ? [hit] : [];
}

function extractGrepMatches(output: unknown): SearchResult[] {
  if (!Array.isArray(output)) {
    return [];
  }
  const out: SearchResult[] = [];
  for (const row of output) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const m = row as Record<string, unknown>;
    const path = typeof m.path === 'string' ? m.path : '';
    const line = Number(m.line ?? 0);
    if (!path || line <= 0) {
      continue;
    }
    out.push({
      id: 0,
      ...(typeof m.repo === 'string' && m.repo ? { repo: m.repo } : {}),
      path,
      symbol: '',
      start_line: line,
      end_line: line,
      score: 1,
      snippet: typeof m.text === 'string' ? m.text : '',
    });
  }
  return out;
}
