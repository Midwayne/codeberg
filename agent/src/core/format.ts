import type { SearchResult } from './types.js';

export function formatSource(result: SearchResult): string {
  const repo = result.repo ? `[${result.repo}] ` : '';
  const loc = `${repo}${result.path}:${result.start_line}-${result.end_line}`;
  if (result.id > 0) {
    return `${loc} (id=${result.id})`;
  }
  return loc;
}

export function formatSources(results: readonly SearchResult[]): string[] {
  return results.map(formatSource);
}
