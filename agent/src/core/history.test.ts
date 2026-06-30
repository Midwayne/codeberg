import type { ModelMessage } from "ai";
import { describe, expect, it, vi } from "vitest";

import { estimateTokens, fitHistory, totalTokens } from "./history.js";

function turn(role: "user" | "assistant", content: string): ModelMessage {
  return { role, content };
}

describe("token estimation", () => {
  it("counts ~4 chars per token across a transcript", () => {
    expect(estimateTokens("12345678")).toBe(2);
    expect(totalTokens([turn("user", "12345678"), turn("assistant", "1234")])).toBe(
      3,
    );
  });
});

describe("fitHistory", () => {
  it("returns the same array untouched when it already fits", async () => {
    const msgs = [turn("user", "hi"), turn("assistant", "there")];
    const out = await fitHistory(msgs, { budget: 1000 });
    expect(out).toBe(msgs);
  });

  it("drops the oldest behind a marker when no summarizer is given", async () => {
    const msgs = Array.from({ length: 10 }, (_, i) =>
      turn(i % 2 ? "assistant" : "user", "x".repeat(40)),
    );
    const out = await fitHistory(msgs, { budget: 30, keepRecent: 3 });
    expect(out).toHaveLength(4); // marker + 3 recent
    expect(String(out[0]?.content)).toContain("omitted");
    expect(out.slice(1)).toEqual(msgs.slice(-3));
  });

  it("folds overflow into a single summary turn when a summarizer is given", async () => {
    const summarize = vi.fn(async () => "SUMMARY");
    const msgs = Array.from({ length: 8 }, (_, i) =>
      turn(i % 2 ? "assistant" : "user", "y".repeat(40)),
    );
    const out = await fitHistory(msgs, {
      budget: 40,
      keepRecent: 2,
      summarize,
    });
    expect(summarize).toHaveBeenCalledOnce();
    expect(String(out[0]?.content)).toContain("SUMMARY");
    expect(out.slice(-2)).toEqual(msgs.slice(-2));
  });

  it("does not summarize when only recent turns remain over budget", async () => {
    const summarize = vi.fn(async () => "SUMMARY");
    const msgs = [turn("user", "z".repeat(400))];
    const out = await fitHistory(msgs, { budget: 10, keepRecent: 6, summarize });
    expect(summarize).not.toHaveBeenCalled();
    expect(out).toBe(msgs);
  });
});
