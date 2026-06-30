import type { ModelMessage, ToolLoopAgent } from "ai";
import { describe, expect, it } from "vitest";

import {
  applyPromptHooksToMessages,
  applyPromptHooksToText,
  wrapToolLoopAgentWithPromptHooks,
  type PromptHook,
} from "./index.js";

describe("/enhance prompt hook", () => {
  it("rewrites /enhance into an agent brief request", () => {
    const out = applyPromptHooksToText("/enhance add auth middleware");

    expect(out).toContain("Codeberg's /enhance prompt hook");
    expect(out).toContain("Do not implement code");
    expect(out).toContain("Use the available code-search tools first");
    expect(out).toContain("add auth middleware");
    expect(out).toContain("## Impacted Areas");
    expect(out).toContain("## Verification");
  });

  it("leaves non-hook prompts unchanged", () => {
    expect(applyPromptHooksToText("explain auth middleware")).toBe(
      "explain auth middleware",
    );
  });

  it("rewrites only the last user message and keeps prior history intact", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "old question" },
      { role: "assistant", content: "old answer" },
      { role: "user", content: "/enhance fix flaky tests" },
    ];

    const out = applyPromptHooksToMessages(messages);

    expect(out).not.toBe(messages);
    expect(out[0]).toBe(messages[0]);
    expect(out[1]).toBe(messages[1]);
    expect(String(out[2]?.content)).toContain("fix flaky tests");
    expect(String(out[2]?.content)).toContain("# Agent Brief");
    expect(messages[2]?.content).toBe("/enhance fix flaky tests");
  });
});

describe("wrapToolLoopAgentWithPromptHooks", () => {
  const hook: PromptHook = {
    name: "test",
    rewrite: ({ text }) => (text === "hook me" ? "hooked" : undefined),
  };

  it("rewrites generate messages before delegating", async () => {
    let seen: ModelMessage[] | undefined;
    const agent = {
      generate: async (params: { messages: ModelMessage[] }) => {
        seen = params.messages;
        return { text: "ok" };
      },
    } as unknown as ToolLoopAgent;

    const wrapped = wrapToolLoopAgentWithPromptHooks(agent, [hook]);
    await wrapped.generate({
      messages: [{ role: "user", content: "hook me" }],
    } as never);

    expect(seen).toEqual([{ role: "user", content: "hooked" }]);
  });

  it("rewrites stream prompts before delegating", async () => {
    let seen: ModelMessage[] | undefined;
    const agent = {
      stream: async (params: { prompt: ModelMessage[] }) => {
        seen = params.prompt;
        return { fullStream: [] };
      },
    } as unknown as ToolLoopAgent;

    const wrapped = wrapToolLoopAgentWithPromptHooks(agent, [hook]);
    await wrapped.stream({
      prompt: [{ role: "user", content: "hook me" }],
    } as never);

    expect(seen).toEqual([{ role: "user", content: "hooked" }]);
  });
});
