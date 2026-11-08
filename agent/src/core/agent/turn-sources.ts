import { AsyncLocalStorage } from 'node:async_hooks';

import type { SearchResult } from '../types.js';

const current = new AsyncLocalStorage<SearchResult[]>();

/** Record hits for the ask that is in progress. No-op when nothing is collecting. */
export function recordSearchHits(hits: readonly SearchResult[]): void {
  current.getStore()?.push(...hits);
}

/** Collect search hits for one turn. A pooled loop does not retain them. */
export async function withSearchHits<T>(fn: () => Promise<T>): Promise<{ value: T; sources: SearchResult[] }> {
  const sources: SearchResult[] = [];
  const value = await current.run(sources, fn);

  return { value, sources };
}
