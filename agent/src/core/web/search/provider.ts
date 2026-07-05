import type { WebConfig, WebDeps, WebSearchResult } from '../types.js';
import { searxngProvider } from './searxng.js';

/**
 * A backend the `web_search` tool can query. This mirrors the model-provider
 * seam: a new search backend (Brave, Tavily, a corporate index) is a new adapter
 * satisfying this interface, not an edit to the tool or the client.
 */
export interface WebSearchProvider {
  readonly name: string;
  search(query: string, opts: { count: number }): Promise<WebSearchResult[]>;
}

const DEFAULT_DEPS: WebDeps = {
  fetchImpl: (input, init) => globalThis.fetch(input as RequestInfo, init),
};

/**
 * Resolve the configured web-search backend, or `undefined` when none is set —
 * in which case `web_search` stays unregistered and `fetch_url` still works.
 * Today only SearXNG (selected by `CODEBERG_SEARXNG_URL`); a second backend is
 * one more adapter plus a branch here.
 */
export function webSearchProviderFromConfig(
  config: WebConfig,
  deps: WebDeps = DEFAULT_DEPS,
): WebSearchProvider | undefined {
  if (config.searxngUrl) {
    return searxngProvider({
      baseUrl: config.searxngUrl,
      timeoutMs: config.timeoutMs,
      fetchImpl: deps.fetchImpl,
    });
  }
  return undefined;
}
