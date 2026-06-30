import { describe, expect, it } from "vitest";

import { fetchUrl } from "./client.js";
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

function res(r: {
  status: number;
  headers: Record<string, string>;
  body?: string;
  url?: string;
}): Response {
  const lower = Object.fromEntries(
    Object.entries(r.headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    statusText: "",
    url: r.url ?? "",
    headers: { get: (k: string) => lower[k.toLowerCase()] ?? null },
    body: null,
    text: async () => r.body ?? "",
    json: async () => JSON.parse(r.body ?? "null"),
  } as unknown as Response;
}

/** A fetch stub that returns queued responses in order (repeating the last),
 *  recording every URL it was asked to fetch. */
function sequence(responses: Response[], calls?: URL[]): WebDeps {
  let i = 0;
  return {
    fetchImpl: (async (input: unknown) => {
      if (calls) calls.push(new URL(String(input)));
      return responses[Math.min(i++, responses.length - 1)];
    }) as unknown as typeof fetch,
  };
}

describe("fetchUrl redirect handling", () => {
  it("follows a public redirect and returns the final page", async () => {
    const calls: URL[] = [];
    const deps = sequence(
      [
        res({ status: 302, headers: { location: "https://example.org/final" } }),
        res({
          status: 200,
          headers: { "content-type": "text/html" },
          body: "<title>T</title><p>done</p>",
          url: "https://example.org/final",
        }),
      ],
      calls,
    );
    const out = await fetchUrl("https://example.com/start", cfg(), deps);
    expect(out.text).toContain("done");
    expect(calls.map((u) => u.href)).toEqual([
      "https://example.com/start",
      "https://example.org/final",
    ]);
  });

  it("refuses a redirect into a private host before fetching it (SSRF)", async () => {
    const calls: URL[] = [];
    const deps = sequence(
      [
        res({
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
        }),
        res({ status: 200, headers: { "content-type": "text/plain" }, body: "secrets" }),
      ],
      calls,
    );
    await expect(fetchUrl("https://example.com/start", cfg(), deps)).rejects.toThrow(
      /private|blocked/,
    );
    // The private target must never have been requested.
    expect(calls.map((u) => u.href)).toEqual(["https://example.com/start"]);
  });

  it("caps the redirect chain", async () => {
    const deps = sequence([
      res({ status: 302, headers: { location: "https://loop.example/x" } }),
    ]);
    await expect(fetchUrl("https://example.com/start", cfg(), deps)).rejects.toThrow(
      /too many redirects/,
    );
  });
});
