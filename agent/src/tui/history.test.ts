import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  historyFilePath,
  loadHistory,
  pushHistory,
  saveHistory,
} from "./history.js";

describe("pushHistory", () => {
  it("appends a new prompt", () => {
    expect(pushHistory(["a"], "b")).toEqual(["a", "b"]);
  });

  it("trims and ignores blank prompts", () => {
    expect(pushHistory(["a"], "   ")).toEqual(["a"]);
    expect(pushHistory(["a"], "  b  ")).toEqual(["a", "b"]);
  });

  it("drops an immediate duplicate of the last entry", () => {
    expect(pushHistory(["a", "b"], "b")).toEqual(["a", "b"]);
    // A non-consecutive repeat is kept.
    expect(pushHistory(["a", "b"], "a")).toEqual(["a", "b", "a"]);
  });

  it("caps the list to the newest 500 entries", () => {
    const many = Array.from({ length: 500 }, (_, i) => `q${i}`);
    const next = pushHistory(many, "newest");
    expect(next).toHaveLength(500);
    expect(next.at(-1)).toBe("newest");
    expect(next[0]).toBe("q1");
  });
});

describe("historyFilePath", () => {
  it("honours XDG_STATE_HOME", () => {
    expect(historyFilePath({ XDG_STATE_HOME: "/state" })).toBe(
      "/state/codeberg/prompt-history.json",
    );
  });

  it("falls back to ~/.local/state", () => {
    const path = historyFilePath({});
    expect(path).toMatch(/[/\\]\.local[/\\]state[/\\]codeberg[/\\]prompt-history\.json$/);
  });
});

describe("load/save round trip", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "codeberg-hist-"));
    process.env.XDG_STATE_HOME = dir;
  });

  afterEach(() => {
    delete process.env.XDG_STATE_HOME;
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty list when nothing is saved", () => {
    expect(loadHistory()).toEqual([]);
  });

  it("persists and reloads prompts", () => {
    saveHistory(["first", "second"]);
    expect(loadHistory()).toEqual(["first", "second"]);
  });

  it("ignores corrupt history files", () => {
    saveHistory(["ok"]);
    writeFileSync(historyFilePath(), "{not json", "utf8");
    expect(loadHistory()).toEqual([]);
  });
});
