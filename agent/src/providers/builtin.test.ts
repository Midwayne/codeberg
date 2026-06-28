import { describe, expect, it } from "vitest";

import { llamacppProvider } from "./builtin.js";
import { defaultProviders } from "./index.js";

describe("llamacppProvider", () => {
  it("registers by default without any API key", () => {
    // Local providers are always available; external ones need their key.
    expect(defaultProviders().list()).toContain("llamacpp");
  });

  it("resolves a free-form model id", () => {
    const m = llamacppProvider().model("ornith-1.0-35b");
    expect((m as { modelId: string }).modelId).toBe("ornith-1.0-35b");
  });
});
