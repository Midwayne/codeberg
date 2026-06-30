import type { ModelMessage } from "ai";
import { describe, expect, it, vi } from "vitest";

import { Agent } from "./agent.js";
import { DaemonClient } from "./client.js";
import type { Generator } from "./types.js";
import type { ModelProfile } from "../providers/profiles.js";

// contextWindow 2000 -> history budget 1000 tokens (~4000 chars).
const smallWindow: ModelProfile = {
  provider: "test",
  modelId: "test",
  contextWindow: 2000,
  cache: "none",
};

function agentWith(generator: Generator): Agent {
  return new Agent({
    model: {} as never,
    daemon: new DaemonClient("http://127.0.0.1:8080"),
    generator,
    profile: smallWindow,
  });
}

describe("Agent.compactHistory", () => {
  it("returns history unchanged when it fits the budget", async () => {
    const summarize = vi.fn(async () => "SUMMARY");
    const agent = agentWith({ generate: summarize });
    const messages: ModelMessage[] = [
      { role: "user", content: "short" },
      { role: "assistant", content: "answer" },
    ];
    const out = await agent.compactHistory(messages);
    expect(out).toBe(messages);
    expect(summarize).not.toHaveBeenCalled();
  });

  it("summarizes older turns once the transcript exceeds the window", async () => {
    const summarize = vi.fn(async () => "SUMMARY");
    const agent = agentWith({ generate: summarize });
    const turn = "x".repeat(600); // ~150 tokens each
    const messages: ModelMessage[] = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      content: turn,
    }));
    const out = await agent.compactHistory(messages);
    expect(summarize).toHaveBeenCalledOnce();
    expect(String(out[0]?.content)).toContain("SUMMARY");
    expect(out.length).toBeLessThan(messages.length);
  });
});
