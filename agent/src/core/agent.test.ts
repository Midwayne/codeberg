import { afterEach, describe, expect, it, vi } from "vitest";

import { Agent } from "./agent.js";
import { DaemonClient } from "./client.js";
import type { Generator } from "./types.js";

describe("Agent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("askOnce searches then generates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/search")) {
          return Response.json({
            results: [
              {
                id: 1,
                path: "ipc.c",
                symbol: "",
                start_line: 1,
                end_line: 2,
                score: 0.8,
                snippet: "status handler",
              },
            ],
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const generator: Generator = {
      generate: async (p) => {
        expect(p.prompt).toContain("ipc.c:1-2");
        return "search uses unix socket";
      },
    };

    const agent = new Agent({
      model: {} as never,
      daemon: new DaemonClient("http://127.0.0.1:8080"),
      generator,
    });

    const result = await agent.askOnce("how does search work?");
    expect(result.answer).toBe("search uses unix socket");
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.path).toBe("ipc.c");
  });
});
