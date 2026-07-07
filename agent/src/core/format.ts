import type { SearchResult } from './types.js';

export function formatSource(result: SearchResult): string {
  const repo = result.repo ? `[${result.repo}] ` : '';
  const loc = `${repo}${result.path}:${result.start_line}-${result.end_line}`;
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
