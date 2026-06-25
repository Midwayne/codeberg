import type { SearchOptions, SearchResult, ToolSpec } from "./types.js";

export class DaemonClient {
  constructor(private readonly baseUrl: string) {}

  async search(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
    const url = new URL("/search", this.baseUrl);
    url.searchParams.set("q", query);
    if (opts.k != null) {
      url.searchParams.set("k", String(opts.k));
    }
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`search failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { results: SearchResult[] };
    return body.results.map(normalizeHit);
  }

  async listTools(): Promise<ToolSpec[]> {
    const res = await fetch(new URL("/tools", this.baseUrl));
    if (!res.ok) {
      throw new Error(`list tools failed: ${res.status}`);
    }
    const body = (await res.json()) as {
      tools: { name: string; description: string; schema: Record<string, unknown> }[];
    };
    return body.tools.map((t) => ({
      name: t.name,
      description: t.description,
      schema: t.schema,
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(new URL("/tools/call", this.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, args }),
    });
    if (!res.ok) {
      throw new Error(`tool ${name} failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { result: unknown };
    return body.result;
  }
}

function normalizeHit(r: SearchResult): SearchResult {
  return {
    id: Number(r.id),
    path: r.path ?? "",
    symbol: r.symbol ?? "",
    start_line: Number(r.start_line ?? 0),
    end_line: Number(r.end_line ?? 0),
    score: Number(r.score ?? 0),
    snippet: r.snippet ?? "",
  };
}
