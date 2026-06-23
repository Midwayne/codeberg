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
});
