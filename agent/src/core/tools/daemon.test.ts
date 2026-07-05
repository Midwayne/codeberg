import { describe, expect, it, vi } from "vitest";

import type { DaemonClient } from "../client.js";
import { daemonToolSource } from "./daemon.js";

function run(toolDef: unknown, input: unknown): Promise<any> {
  return (
    toolDef as { execute: (i: unknown, o: unknown) => Promise<unknown> }
  ).execute(input, { toolCallId: "t", messages: [] }) as Promise<any>;
}

describe("daemonToolSource", () => {
  it("bridges each advertised tool and forwards calls to the daemon", async () => {
    const daemon = {
      listTools: vi.fn(async () => [
        { name: "grep", description: "exact search", schema: { type: "object" } },
        { name: "search", description: "vector search", schema: { type: "object" } },
        { name: "read_file", description: "read", schema: { type: "object" } },
      ]),
      callTool: vi.fn(async () => ({ ok: true })),
    } as unknown as DaemonClient;

    const set = await daemonToolSource(daemon).tools();
    expect(Object.keys(set).sort()).toEqual(["grep", "read_file"]);

    const out = await run(set.grep, { pattern: "x" });
    expect(daemon.callTool).toHaveBeenCalledWith("grep", { pattern: "x" });
    expect(out).toEqual({ ok: true });
  });
});
