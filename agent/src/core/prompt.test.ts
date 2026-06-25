import { describe, expect, it } from "vitest";

import { buildPrompt } from "./prompt.js";

describe("buildPrompt", () => {
  it("formats chunks with citations", () => {
    const p = buildPrompt("how does search work?", [
      {
        path: "main.go",
        symbol: "main",
        start_line: 1,
        end_line: 3,
        snippet: "package main",
      },
    ]);
    expect(p.prompt).toContain("[1] main.go:1-3 main");
    expect(p.prompt).toContain("package main");
    expect(p.prompt).toContain("how does search work?");
    expect(p.system).toContain("retrieved code");
  });

  it("handles empty results", () => {
    const p = buildPrompt("anything?", []);
    expect(p.prompt).toContain("No chunks retrieved");
  });

  it("includes prior conversation", () => {
    const p = buildPrompt("follow up?", [], [
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
    ]);
    expect(p.prompt).toContain("User: first question");
    expect(p.prompt).toContain("Assistant: first answer");
  });
});
