import type { SearchResult } from './types.js';

type Location = Pick<SearchResult, 'repo' | 'path' | 'start_line' | 'end_line'>;

/** `[repo] path:start-end`, the citation form agents and the ledger share. */
export function formatLocation(result: Location): string {
  const repo = result.repo ? `[${result.repo}] ` : '';

  return `${repo}${result.path}:${result.start_line}-${result.end_line}`;
}

export function formatSource(result: SearchResult): string {
  const loc = formatLocation(result);
  if (result.id > 0) {
    return `${loc} (id=${result.id})`;
  }

  return loc;
}

/** One-line header for hybrid hits (final score + optional lexical boost). */
export function formatScoredSource(result: SearchResult, boost?: number): string {
  const sym = result.symbol ? ` ${result.symbol}` : '';
  const boostStr = boost != null && boost > 0 ? ` boost=${boost}` : '';

  return `${formatSource(result)}${sym}  score=${result.score.toFixed(3)}${boostStr}`;
}
