/** Resolved web-access configuration for the agent. Web use is on by default
 *  (CODEBERG_WEB_USE); `web_search` additionally needs a SearXNG endpoint. */
export interface WebConfig {
  /** Master switch (CODEBERG_WEB_USE). When false, no web tools are registered. */
  enabled: boolean;
  /** SearXNG base URL for web_search (CODEBERG_SEARXNG_URL). Empty disables search. */
  searxngUrl: string;
  /** Max bytes read from a fetched response body (bounds network + parse cost). */
  maxBytes: number;
  /** Max characters of extracted text returned to the model (bounds tokens). */
  maxChars: number;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
  /** Default number of search results to return. */
  searchCount: number;
  /** Allow fetching private/loopback hosts (CODEBERG_WEB_ALLOW_PRIVATE). */
  allowPrivate: boolean;
}

/** A single web-search hit (provider-agnostic shape). */
export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** The readable form of a fetched page or text resource. */
export interface WebPage {
  /** Final URL after redirects. */
  url: string;
  /** Page <title>, when present. */
  title: string;
  /** Extracted, whitespace-normalized text. */
  text: string;
  /** True when the body or text was cut to fit the byte/char caps. */
  truncated: boolean;
}

/** Injectable network seam so the web tools are testable without real HTTP. */
export interface WebDeps {
  fetchImpl: typeof fetch;
}
