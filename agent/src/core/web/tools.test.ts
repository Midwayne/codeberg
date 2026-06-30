import { describe, expect, it } from "vitest";

import { webTools } from "./tools.js";
import type { WebConfig, WebDeps } from "./types.js";

function cfg(over: Partial<WebConfig> = {}): WebConfig {
  return {
    enabled: true,
    searxngUrl: "",
    maxBytes: 1_000_000,
    maxChars: 20_000,
    timeoutMs: 5_000,
    searchCount: 6,
    allowPrivate: false,
    ...over,
  };
}

function fakeResponse(opts: {
  body: string;
  contentType?: string;
  ok?: boolean;
  status?: number;
  url?: string;
  json?: unknown;
}): Response {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    statusText: "OK",
    url: opts.url ?? "https://example.com/",
    headers: {
      get: (k: string) =>
        k.toLowerCase() === "content-type" ? opts.contentType ?? "text/html" : null,
    },
    body: null,
    text: async () => opts.body,
    json: async () => opts.json ?? JSON.parse(opts.body),
  } as unknown as Response;
}

function depsReturning(response: Response, capture?: { url?: string }): WebDeps {
  return {
    fetchImpl: (async (input: unknown) => {
      if (capture) capture.url = String(input);
      return response;
    }) as unknown as typeof fetch,
  };
}

// ai-sdk tool.execute requires a second (options) argument; tests don't use it.
function run(t: unknown, input: unknown): Promise<any> {
  return (t as { execute: (i: unknown, o: unknown) => Promise<unknown> }).execute(
    input,
    { toolCallId: "test", messages: [] },
  ) as Promise<any>;
}

describe("webTools registration", () => {
  it("registers nothing when web use is disabled", () => {
    expect(Object.keys(webTools(cfg({ enabled: false })))).toEqual([]);
  });

  it("registers fetch_url only when no search backend is configured", () => {
    expect(Object.keys(webTools(cfg())).sort()).toEqual(["fetch_url"]);
  });

  it("registers web_search when a SearXNG URL is set", () => {
    expect(Object.keys(webTools(cfg({ searxngUrl: "http://sx:8888" }))).sort()).toEqual([
      "fetch_url",
      "web_search",
    ]);
  });
});

describe("fetch_url tool", () => {
  it("returns the extracted title and text of an HTML page", async () => {
    const tools = webTools(
      cfg(),
      depsReturning(fakeResponse({ body: "<title>T</title><p>Hello world</p>" })),
    );
    const out = await run(tools.fetch_url, { url: "https://example.com" });
    expect(out.title).toBe("T");
    expect(out.text).toContain("Hello world");
    expect(out.truncated).toBe(false);
  });

  it("truncates text past the char cap", async () => {
    const tools = webTools(
      cfg({ maxChars: 5 }),
      depsReturning(fakeResponse({ body: "<p>abcdefghij</p>" })),
    );
    const out = await run(tools.fetch_url, { url: "https://example.com" });
    expect(out.truncated).toBe(true);
    expect(out.text).toContain("[truncated]");
  });

  it("refuses private/loopback hosts before any fetch", async () => {
    let called = false;
    const deps: WebDeps = {
      fetchImpl: (async () => {
        called = true;
        return fakeResponse({ body: "" });
      }) as unknown as typeof fetch,
    };
    const tools = webTools(cfg(), deps);
    await expect(run(tools.fetch_url, { url: "http://localhost:8080" })).rejects.toThrow(
      /private/,
    );
    expect(called).toBe(false);
  });
});

describe("web_search tool", () => {
  it("maps SearXNG results and drops entries without a url", async () => {
    const body = JSON.stringify({
      results: [
        { title: "A", url: "https://a", content: "snip" },
        { url: "https://b" },
        { title: "C", content: "no url" },
      ],
    });
    const tools = webTools(
      cfg({ searxngUrl: "http://sx:8888" }),
      depsReturning(fakeResponse({ body, contentType: "application/json" })),
    );
    const out = await run(tools.web_search, { query: "q" });
    expect(out.results).toEqual([
      { title: "A", url: "https://a", snippet: "snip" },
      { title: "", url: "https://b", snippet: "" },
    ]);
  });

  it("queries the configured SearXNG JSON endpoint", async () => {
    const capture: { url?: string } = {};
    const tools = webTools(
      cfg({ searxngUrl: "http://sx:8888" }),
      depsReturning(
        fakeResponse({ body: '{"results":[]}', contentType: "application/json" }),
        capture,
      ),
    );
    await run(tools.web_search, { query: "hello world" });
    expect(capture.url).toContain("http://sx:8888/search");
    expect(capture.url).toContain("q=hello+world");
    expect(capture.url).toContain("format=json");
  });
});
