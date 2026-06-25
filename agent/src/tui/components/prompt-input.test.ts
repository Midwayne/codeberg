import { describe, expect, it } from "vitest";

import { feedPaste, sanitizePaste } from "./prompt-input.js";

describe("sanitizePaste", () => {
  it("flattens newlines and tabs to spaces", () => {
    expect(sanitizePaste("line1\nline2\tend")).toBe("line1 line2 end");
  });

  it("strips bracketed-paste markers", () => {
    expect(sanitizePaste("[200~hello world[201~")).toBe("hello world");
  });

  it("removes control characters", () => {
    const nul = String.fromCharCode(0);
    const bell = String.fromCharCode(7);
    expect(sanitizePaste(`a${nul}b${bell}c`)).toBe("abc");
  });

  it("leaves normal prompt text unchanged", () => {
    expect(sanitizePaste("how do we calculate units?")).toBe(
      "how do we calculate units?",
    );
  });
});

describe("feedPaste", () => {
  it("ignores input with no start marker", () => {
    expect(feedPaste(null, "hello")).toEqual({ buffer: null, complete: null });
  });

  it("handles a paste delivered in one event", () => {
    expect(feedPaste(null, "[200~hello world[201~")).toEqual({
      buffer: null,
      complete: "hello world",
    });
  });

  it("buffers a paste split across several events", () => {
    // The body can arrive split at an arbitrary boundary (here mid-word);
    // chunks must rejoin seamlessly.
    const first = feedPaste(null, "[200~line one\nli");
    expect(first).toEqual({ buffer: "line one\nli", complete: null });

    const second = feedPaste(first.buffer, "ne two");
    expect(second).toEqual({ buffer: "line one\nline two", complete: null });

    const third = feedPaste(second.buffer, "[201~");
    expect(third).toEqual({
      buffer: null,
      complete: "line one line two",
    });
  });

  it("flattens newlines in the completed paste", () => {
    expect(feedPaste(null, "[200~a\nb\tc[201~").complete).toBe("a b c");
  });
});
