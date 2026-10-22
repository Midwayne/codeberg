/** Direct URL fetching is on by default (CODEBERG_WEB_USE). Web search requires
 *  a separate opt-in (CODEBERG_WEB_SEARCH_USE) and a SearXNG endpoint. */
export interface WebConfig {
  /** Master switch (CODEBERG_WEB_USE). When false, no web tools are registered. */
  enabled: boolean;
  /** Search opt-in (CODEBERG_WEB_SEARCH_USE), off by default. URL fetching is independent. */
  searchEnabled: boolean;
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

/** Global browser tool preferences and managed search availability. */
export interface ToolSettings {
  browserUse: boolean;
  browserVision: boolean;
  webSearch: boolean;
  allowed: boolean;
  provider: 'managed' | 'external' | 'unavailable';
  status: 'disabled' | 'starting' | 'ready' | 'error' | 'unavailable';
  message?: string;
}

/** Validate data at the settings HTTP boundary before using it as render state. */
export function isToolSettings(value: unknown): value is ToolSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const input = value as Record<string, unknown>;

  return typeof input.browserUse === 'boolean' && typeof input.browserVision === 'boolean' &&
    typeof input.webSearch === 'boolean' && typeof input.allowed === 'boolean' &&
    typeof input.provider === 'string' && ['managed', 'external', 'unavailable'].includes(input.provider) &&
    typeof input.status === 'string' && ['disabled', 'starting', 'ready', 'error', 'unavailable'].includes(input.status) &&
    (input.message === undefined || typeof input.message === 'string');
}
