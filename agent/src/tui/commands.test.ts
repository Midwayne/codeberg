import { describe, expect, it } from "vitest";

import {
  deriveTitle,
  formatSessionList,
  parseCommand,
  relativeTime,
  stripCommandTurns,
} from "./commands.js";

describe("parseCommand", () => {
  it("recognises known verbs and aliases", () => {
    expect(parseCommand("/help")).toEqual({ kind: "help" });
    expect(parseCommand("/?")).toEqual({ kind: "help" });
    expect(parseCommand("/")).toEqual({ kind: "help" });
    expect(parseCommand("/sessions")).toEqual({ kind: "sessions" });
    expect(parseCommand("/list")).toEqual({ kind: "sessions" });
    expect(parseCommand("/new")).toEqual({ kind: "new" });
    expect(parseCommand("/clear")).toEqual({ kind: "new" });
  });

  it("captures the resume argument and trims/lowercases the verb", () => {
    expect(parseCommand("  /Resume a3f2 ")).toEqual({
      kind: "resume",
      arg: "a3f2",
    });
    expect(parseCommand("/resume")).toEqual({ kind: "resume", arg: "" });
  });

  it("ignores non-commands so paths and prose reach the model", () => {
    expect(parseCommand("/etc/hosts is the file")).toBeNull();
    expect(parseCommand("/unknown")).toBeNull();
    expect(parseCommand("what is auth?")).toBeNull();
    expect(parseCommand("")).toBeNull();
  });
});

describe("stripCommandTurns", () => {
  it("removes command turns and their synthetic replies", () => {
    const cleaned = stripCommandTurns([
      { role: "user", content: "real question" },
      { role: "assistant", content: "real answer" },
      { role: "user", content: "/sessions" },
      { role: "assistant", content: "<session list>" },
      { role: "user", content: "follow up" },
    ]);
    expect(cleaned).toEqual([
      { role: "user", content: "real question" },
      { role: "assistant", content: "real answer" },
      { role: "user", content: "follow up" },
    ]);
  });

  it("drops a trailing command with no reply yet", () => {
    expect(
      stripCommandTurns([{ role: "user", content: "/help" }]),
    ).toEqual([]);
  });
});

describe("formatSessionList", () => {
  it("explains the empty state", () => {
    expect(formatSessionList([])).toContain("No saved sessions");
  });

  it("renders rows with id, title, age and turn count", () => {
    const now = 10_000_000;
    const out = formatSessionList(
      [{ id: "a3f2", title: "jwt auth bug", updatedAt: now - 7200_000, turns: 12 }],
      now,
    );
    expect(out).toContain("a3f2");
    expect(out).toContain('"jwt auth bug"');
    expect(out).toContain("2h ago");
    expect(out).toContain("12 turns");
    expect(out).toContain("/resume <id>");
  });
});

describe("relativeTime", () => {
  it("buckets durations", () => {
    const now = 1_000_000_000;
    expect(relativeTime(now, now)).toBe("just now");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(relativeTime(now - 2 * 3600_000, now)).toBe("2h ago");
    expect(relativeTime(now - 3 * 86_400_000, now)).toBe("3d ago");
  });
});

describe("deriveTitle", () => {
  it("uses the first user message, condensed", () => {
    expect(
      deriveTitle([
        { role: "user", content: "  why does\n  login   fail? " },
        { role: "assistant", content: "..." },
      ]),
    ).toBe("why does login fail?");
  });
});
