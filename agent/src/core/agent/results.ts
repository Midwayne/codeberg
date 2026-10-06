import { chunkKey, type RunPerformance, type SearchResult } from '../types.js';

export function toPerformance(
  perf: { effectiveOutputTokensPerSecond?: number; responseTimeMs?: number } | undefined,
): RunPerformance | undefined {
  if (!perf) {
    return undefined;
  }

  return {
    outputTokensPerSecond: perf.effectiveOutputTokensPerSecond,
    responseTimeMs: perf.responseTimeMs,
  };
}

export function dedupe(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of results) {
    const key = chunkKey(r);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(r);
    }
  }

  return out;
}
