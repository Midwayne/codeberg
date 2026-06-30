import { htmlToText } from "./html.js";
import { assertFetchableUrl } from "./ssrf.js";
import type { WebConfig, WebDeps, WebPage, WebSearchResult } from "./types.js";

const USER_AGENT = "codeberg-agent/0.1 (+https://codeberg.org)";

/** Cap on redirect hops, each of which is re-validated against the SSRF guard. */
const MAX_REDIRECTS = 5;

const DEFAULT_DEPS: WebDeps = {
  fetchImpl: (input, init) => globalThis.fetch(input as RequestInfo, init),
};

/**
 * Fetch an http(s) URL and return its readable text. HTML is reduced to text;
 * plain-text/JSON is passed through; other content types are reported but not
 * decoded. The URL is SSRF-checked first, the body is capped at `maxBytes`, and
 * the extracted text is capped at `maxChars` so a huge page can't blow the
 * context window.
 */
export async function fetchUrl(
  rawUrl: string,
  config: WebConfig,
  deps: WebDeps = DEFAULT_DEPS,
): Promise<WebPage> {
  const url = assertFetchableUrl(rawUrl, { allowPrivate: config.allowPrivate });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await fetchNoOpenRedirect(url, config, deps, controller.signal);
    if (!res.ok) {
      throw new Error(`fetch failed: ${res.status} ${res.statusText} for ${url}`);
    }

    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    const finalUrl = res.url || url.toString();
    const { body, truncated: bodyTruncated } = await readCapped(res, config.maxBytes);

    if (contentType.includes("html") || (contentType === "" && /^\s*</.test(body))) {
      const page = htmlToText(body);
      const capped = capText(page.text, config.maxChars);
      return {
        url: finalUrl,
        title: page.title,
        text: capped.text,
        truncated: bodyTruncated || capped.truncated,
      };
    }

    if (
      contentType.includes("json") ||
      contentType.startsWith("text/") ||
      contentType === ""
    ) {
      const capped = capText(body, config.maxChars);
      return {
        url: finalUrl,
        title: "",
        text: capped.text,
        truncated: bodyTruncated || capped.truncated,
      };
    }

    return {
      url: finalUrl,
      title: "",
      text: `[unsupported content-type: ${contentType || "unknown"}]`,
      truncated: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch following redirects manually so each hop is re-checked against the SSRF
 * guard. The default `redirect: "follow"` would let a public URL bounce to
 * `http://169.254.169.254` or `localhost` unchecked — the dangerous request goes
 * out before any final-URL inspection. Here every `Location` is validated with
 * `assertFetchableUrl` *before* it is followed, so a redirect into a private or
 * blocked host is refused instead of fetched.
 */
async function fetchNoOpenRedirect(
  start: URL,
  config: WebConfig,
  deps: WebDeps,
  signal: AbortSignal,
): Promise<Response> {
  let current = start;
  for (let hop = 0; ; hop++) {
    const res = await deps.fetchImpl(current, {
      signal,
      redirect: "manual",
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5",
      },
    });

    const location = isRedirect(res.status) ? res.headers.get("location") : null;
    if (!location) {
      return res;
    }
    if (hop >= MAX_REDIRECTS) {
      throw new Error(`too many redirects (>${MAX_REDIRECTS}) starting at ${start}`);
    }
    // Resolve relative redirects against the current URL, then re-validate.
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new Error(`invalid redirect target "${location}" from ${current}`);
    }
    assertFetchableUrl(next.toString(), { allowPrivate: config.allowPrivate });
    current = next;
  }
}

function isRedirect(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

/**
 * Search the web via a SearXNG instance (open-source, self-hosted, no API key).
 * Requires `searxngUrl`; the instance must have the JSON output format enabled
 * (`search.formats: [html, json]` in its settings).
 */
export async function searxngSearch(
  query: string,
  config: WebConfig,
  deps: WebDeps = DEFAULT_DEPS,
  count = config.searchCount,
): Promise<WebSearchResult[]> {
  if (!config.searxngUrl) {
    throw new Error(
      "web_search is not configured — set CODEBERG_SEARXNG_URL to a SearXNG instance",
    );
  }
  const url = new URL("/search", config.searxngUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await deps.fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": USER_AGENT },
    });
    if (!res.ok) {
      throw new Error(
        `web search failed: ${res.status} ${res.statusText} ` +
          "(is the SearXNG JSON format enabled?)",
      );
    }
    const data = (await res.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    const results = Array.isArray(data.results) ? data.results : [];
    return results
      .map((r) => ({
        title: (r.title ?? "").trim(),
        url: (r.url ?? "").trim(),
        snippet: (r.content ?? "").trim(),
      }))
      .filter((r) => r.url)
      .slice(0, count);
  } finally {
    clearTimeout(timer);
  }
}

/** Read a response body up to `maxBytes`, streaming when possible so an oversize
 *  page is cut off rather than fully buffered. Falls back to `text()` for fakes
 *  (tests) and responses without a readable stream. */
async function readCapped(
  res: {
    body?: ReadableStream<Uint8Array> | null;
    text(): Promise<string>;
  },
  maxBytes: number,
): Promise<{ body: string; truncated: boolean }> {
  const stream = res.body;
  if (stream && typeof stream.getReader === "function") {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let out = "";
    let total = 0;
    let truncated = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total + value.byteLength > maxBytes) {
        const remaining = Math.max(0, maxBytes - total);
        out += decoder.decode(value.subarray(0, remaining));
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
      total += value.byteLength;
      out += decoder.decode(value, { stream: true });
    }
    return { body: out, truncated };
  }

  const text = await res.text();
  return text.length > maxBytes
    ? { body: text.slice(0, maxBytes), truncated: true }
    : { body: text, truncated: false };
}

function capText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `${text.slice(0, maxChars)}\n\n[truncated]`, truncated: true };
}
