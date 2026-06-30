import type { WebSearchResult } from "../types.js";

const USER_AGENT = "codeberg-agent/0.1 (+https://codeberg.org)";

/**
 * SearXNG (open-source, self-hosted, no API key) as a web-search backend. The
 * instance must have the JSON output format enabled
 * (`search.formats: [html, json]`). All of SearXNG's quirks — the `/search`
 * path, the `format=json` query, the result shape — are contained here.
 */
export function searxngProvider(opts: {
  baseUrl: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}) {
  return {
    name: "searxng",
    async search(
      query: string,
      { count }: { count: number },
    ): Promise<WebSearchResult[]> {
      const url = new URL("/search", opts.baseUrl);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "json");

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
      try {
        const res = await opts.fetchImpl(url, {
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
    },
  };
}
