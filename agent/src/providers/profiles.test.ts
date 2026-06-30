import { describe, expect, it } from "vitest";

import {
  historyBudget,
  profileFor,
  pruneBudget,
} from "./profiles.js";

describe("profileFor", () => {
  it("maps anthropic non-haiku to a 1M window with anthropic caching", () => {
    const p = profileFor("anthropic:claude-opus-4-8", {});
    expect(p.contextWindow).toBe(1_000_000);
    expect(p.cache).toBe("anthropic");
  });

  it("caps anthropic haiku at 200K", () => {
    expect(profileFor("anthropic:claude-haiku-4-5", {}).contextWindow).toBe(
      200_000,
    );
  });

  it("uses openai caching and ~128K for the 4o family", () => {
    const p = profileFor("openai:gpt-4o-mini", {});
    expect(p.contextWindow).toBe(128_000);
    expect(p.cache).toBe("openai");
  });

  it("widens openai 4.1 / o-series to 1M", () => {
    expect(profileFor("openai:gpt-4.1", {}).contextWindow).toBe(1_000_000);
    expect(profileFor("openai:o3-mini", {}).contextWindow).toBe(1_000_000);
  });

  it("treats local servers as small and openai-compatible for caching", () => {
    const p = profileFor("ollama:llama3", {});
    expect(p.contextWindow).toBe(8_192);
    expect(p.cache).toBe("openai");
  });

  it("honours CODEBERG_CONTEXT_WINDOW for any provider", () => {
    const p = profileFor("llamacpp:local", {
      CODEBERG_CONTEXT_WINDOW: "32768",
    });
    expect(p.contextWindow).toBe(32_768);
  });

  it("ignores a non-positive override", () => {
    expect(
      profileFor("anthropic:claude-opus-4-8", { CODEBERG_CONTEXT_WINDOW: "0" })
        .contextWindow,
    ).toBe(1_000_000);
  });
});

describe("budgets", () => {
  it("reserves half the window for history and 60% for the prune mark", () => {
    const p = profileFor("openai:gpt-4o", {});
    expect(historyBudget(p)).toBe(64_000);
    expect(pruneBudget(p)).toBe(Math.floor(128_000 * 0.6));
  });
});
