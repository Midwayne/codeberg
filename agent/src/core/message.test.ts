import { describe, expect, it } from "vitest";

import { messageText } from "./message.js";

describe("messageText", () => {
  it("returns string content as-is", () => {
    expect(messageText({ role: "user", content: "hi" })).toBe("hi");
  });

  it("concatenates text parts and ignores non-text parts", () => {
    expect(
      messageText({
        role: "assistant",
        content: [
          { type: "text", text: "a" },
          { type: "tool-call", toolCallId: "1", toolName: "x", input: {} },
          { type: "text", text: "b" },
        ],
      }),
    ).toBe("ab");
  });
});
