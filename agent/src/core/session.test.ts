import { afterEach, describe, expect, it, vi } from "vitest";

import { Agent } from "./agent.js";
import { DaemonClient } from "./client.js";
import { ChatSession } from "./session.js";
import type { Generator } from "./types.js";

describe("ChatSession", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps history across turns", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/search")) {
          return Response.json({ results: [] });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    let call = 0;
    const generator: Generator = {
      generate: async (p) => {
        call += 1;
        if (call === 1) {
          expect(p.prompt).not.toContain("User:");
          return "first";
        }
        expect(p.prompt).toContain("User: what is auth?");
        expect(p.prompt).toContain("Assistant: first");
        return "second";
      },
    };

    const session = new ChatSession({
      agent: new Agent({
        model: {} as never,
        daemon: new DaemonClient("http://127.0.0.1:8080"),
        generator,
      }),
      once: true,
    });

    await session.ask("what is auth?");
    await session.ask("tell me more");

    expect(session.history).toHaveLength(4);
    expect(session.history[3]?.content).toBe("second");
  });

  it("clear resets history", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ results: [] })),
    );

    const generator: Generator = {
      generate: async () => "ok",
    };

    const session = new ChatSession({
      agent: new Agent({
        model: {} as never,
        daemon: new DaemonClient("http://127.0.0.1:8080"),
        generator,
      }),
      once: true,
    });

    await session.ask("one");
    let notified = false;
    session.subscribe(() => {
      notified = true;
    });
    session.clear();
    expect(session.history).toHaveLength(0);
    expect(notified).toBe(true);
  });
});
