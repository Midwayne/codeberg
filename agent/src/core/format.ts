import type { SearchResult } from './types.js';

export function formatSource(result: SearchResult): string {
  const repo = result.repo ? `[${result.repo}] ` : '';
  return `${repo}${result.path}:${result.start_line}-${result.end_line} (id=${result.id})`;
}

export function formatSources(results: readonly SearchResult[]): string[] {
  return results.map(formatSource);
}
