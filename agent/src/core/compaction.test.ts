import type { ModelMessage, ToolLoopAgent } from "ai";
import { describe, expect, it, vi } from "vitest";

import { wrapToolLoopAgentWithCompaction } from "./compaction.js";

describe("wrapToolLoopAgentWithCompaction", () => {
  it("compacts the prompt before delegating to stream", async () => {
    let seen: ModelMessage[] | undefined;
    const loop = {
      stream: async (p: { prompt: ModelMessage[] }) => {
        seen = p.prompt;
        return { fullStream: [] };
      },
    } as unknown as ToolLoopAgent;
    const compact = vi.fn(async () => [
      { role: "user", content: "compacted" } as ModelMessage,
    ]);

    const wrapped = wrapToolLoopAgentWithCompaction(loop, compact);
    await wrapped.stream({
      prompt: [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
        { role: "user", content: "c" },
      ],
    } as never);

    expect(compact).toHaveBeenCalledOnce();
    expect(seen).toEqual([{ role: "user", content: "compacted" }]);
  });

  it("compacts generate messages too", async () => {
    let seen: ModelMessage[] | undefined;
    const loop = {
      generate: async (p: { messages: ModelMessage[] }) => {
        seen = p.messages;
        return { text: "ok" };
      },
    } as unknown as ToolLoopAgent;

    const wrapped = wrapToolLoopAgentWithCompaction(loop, async () => [
      { role: "user", content: "fitted" } as ModelMessage,
    ]);
    await wrapped.generate({
      messages: [{ role: "user", content: "x" }],
    } as never);

    expect(seen).toEqual([{ role: "user", content: "fitted" }]);
  });

  it("passes a string prompt through untouched", async () => {
    const loop = {
      stream: async (p: unknown) => ({ params: p }),
    } as unknown as ToolLoopAgent;
    const compact = vi.fn(async (m: ModelMessage[]) => m);

    const wrapped = wrapToolLoopAgentWithCompaction(loop, compact);
    await wrapped.stream({ prompt: "just text" } as never);

    expect(compact).not.toHaveBeenCalled();
  });
});
