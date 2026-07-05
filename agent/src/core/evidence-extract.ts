import { normalizeSearchHit } from './search-hit.js';
import type { SearchResult } from './types.js';

/** Max citeable rows per tool — avoids flooding CLI sources from bulk grep/outline. */
const EVIDENCE_LIMITS: Partial<Record<string, number>> = {
  grep: 20,
  find_references: 20,
  file_outline: 32,
};

export type HybridHit = SearchResult & { grep_boost?: number };

/** Pull citeable code locations from a daemon tool result for sources/ledger. */
export function extractEvidence(toolName: string, output: unknown): SearchResult[] {
  const hits = extractToolHits(toolName, output);
  const limit = EVIDENCE_LIMITS[toolName];
  if (limit != null && hits.length > limit) {
    return hits.slice(0, limit);
  }
  return hits;
}

export function extractToolHits(toolName: string, output: unknown): SearchResult[] {
  switch (toolName) {
    case 'hybrid_search':
      return extractHybridHits(output);
    case 'find_symbol':
    case 'file_outline':
      return extractSearchHits(output);
    case 'get_chunk':
      return extractChunkDetail(output);
    case 'grep':
    case 'find_references':
      return extractGrepMatches(output);
    default:
      return [];
  }
}

export function extractHybridHits(output: unknown): HybridHit[] {
  if (!Array.isArray(output)) {
    return [];
  }
  const out: HybridHit[] = [];
  for (const row of output) {
    if (!row || typeof row !== 'object' || !('hit' in row)) {
      continue;
    }
    const hit = normalizeSearchHit((row as { hit: unknown }).hit);
    if (!hit) {
      continue;
    }
    const r = row as { final_score?: number; grep_boost?: number };
    const finalScore = Number(r.final_score);
    const boost = Number(r.grep_boost ?? 0);
    out.push({
      ...hit,
      score: Number.isFinite(finalScore) ? finalScore : hit.score,
      ...(boost > 0 ? { grep_boost: boost } : {}),
    });
  }
  return out;
}

export function extractSearchHits(output: unknown): SearchResult[] {
  if (!Array.isArray(output)) {
    return [];
  }
  return output.map(normalizeSearchHit).filter((h): h is SearchResult => h != null);
}

export function extractChunkDetail(output: unknown): SearchResult[] {
  const hit = normalizeSearchHit(output);
  return hit ? [hit] : [];
}

export function extractGrepMatches(output: unknown): SearchResult[] {
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
