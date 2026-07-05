import { afterEach, describe, expect, it, vi } from "vitest";

import { DaemonClient } from "./client.js";

describe("DaemonClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("search normalizes hits", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          results: [
            {
              id: "1",
              path: "a.go",
              symbol: "Fn",
              start_line: "2",
              end_line: "5",
              score: "0.9",
              snippet: "func Fn() {}",
            },
          ],
        }),
      ),
    );

    const client = new DaemonClient("http://127.0.0.1:8080");
    const hits = await client.search("add function", { k: 3 });
    expect(hits).toEqual([
      {
        id: 1,
        path: "a.go",
        symbol: "Fn",
        start_line: 2,
        end_line: 5,
        score: 0.9,
        snippet: "func Fn() {}",
      },
    ]);
  });

  it("search forwards filter query params and normalizes repo", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("q")).toBe("auth");
      expect(url.searchParams.get("k")).toBe("5");
      expect(url.searchParams.get("repo")).toBe("alpha");
      expect(url.searchParams.get("path_glob")).toBe("daemon/*");
      expect(url.searchParams.get("kind")).toBe("function");
      expect(url.searchParams.get("min_score")).toBe("0.8");
      return Response.json({
        results: [{ id: 1, repo: "alpha", path: "a.go", score: 0.9, start_line: 1, end_line: 2 }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new DaemonClient("http://127.0.0.1:8080");
    const hits = await client.search("auth", {
      k: 5,
      repo: "alpha",
      path_glob: "daemon/*",
      kind: "function",
      min_score: 0.8,
    });
    expect(hits[0]?.repo).toBe("alpha");
  });

  it("listTools maps specs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          tools: [{ name: "grep", description: "grep files", schema: { type: "object" } }],
        }),
      ),
    );

    const client = new DaemonClient("http://127.0.0.1:8080");
    const tools = await client.listTools();
    expect(tools[0]?.name).toBe("grep");
  });

  it("callTool returns result body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ result: { content: "hi" } })),
    );

    const client = new DaemonClient("http://127.0.0.1:8080");
    const out = await client.callTool("read_file", { path: "x" });
    expect(out).toEqual({ content: "hi" });
  });

  it("search throws structured DaemonError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { ok: false, code: "NOT_IMPLEMENTED", message: "not implemented" },
          { status: 501 },
        ),
      ),
    );

    const client = new DaemonClient("http://127.0.0.1:8080");
    await expect(client.search("q")).rejects.toMatchObject({
      code: "NOT_IMPLEMENTED",
      status: 501,
    });
  });

  it("waitReady polls until ready", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        return Response.json({
          ready: calls >= 2,
          chunks: 1,
          version: "v0",
          vectors_enabled: false,
        });
      }),
    );

    const client = new DaemonClient("http://127.0.0.1:8080");
    const h = await client.waitReady(5000);
    expect(h.ready).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});
