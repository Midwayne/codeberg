import type { SearchResult } from './types.js';

/** Pull citeable code locations from a daemon tool result for sources/ledger. */
export function extractEvidence(toolName: string, output: unknown): SearchResult[] {
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

function extractHybridHits(output: unknown): SearchResult[] {
  if (!Array.isArray(output)) {
    return [];
  }
  return output
    .map((row) => {
      if (!row || typeof row !== 'object' || !('hit' in row)) {
        return null;
      }
      return normalizeHit((row as { hit: unknown }).hit);
    })
    .filter((h): h is SearchResult => h != null);
}

function extractSearchHits(output: unknown): SearchResult[] {
  if (!Array.isArray(output)) {
    return [];
  }
  return output.map(normalizeHit).filter((h): h is SearchResult => h != null);
}

function extractChunkDetail(output: unknown): SearchResult[] {
  const hit = normalizeHit(output);
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

function normalizeHit(raw: unknown): SearchResult | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const path = typeof r.path === 'string' ? r.path : '';
  if (!path) {
    return null;
  }
  const id = Number(r.id ?? 0);
  const start = Number(r.start_line ?? 0);
  const end = Number(r.end_line ?? start);
  return {
    id,
    ...(typeof r.repo === 'string' && r.repo ? { repo: r.repo } : {}),
    path,
    symbol: typeof r.symbol === 'string' ? r.symbol : '',
    start_line: start,
    end_line: end,
    score: Number(r.score ?? 1),
    snippet: typeof r.snippet === 'string' ? r.snippet : typeof r.body === 'string' ? r.body.slice(0, 400) : '',
  };
}
