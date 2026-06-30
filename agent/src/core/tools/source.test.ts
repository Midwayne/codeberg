import type { ToolSet } from "ai";
import { describe, expect, it } from "vitest";

import { collectTools, type ToolSource } from "./source.js";

function src(name: string, set: ToolSet): ToolSource {
  return { name, tools: () => set };
}

describe("collectTools", () => {
  it("merges sources in order", async () => {
    const merged = await collectTools([
      src("a", { x: {} as never }),
      src("b", { y: {} as never }),
    ]);
    expect(Object.keys(merged).sort()).toEqual(["x", "y"]);
  });

  it("lets earlier sources win on a name collision (no shadowing core tools)", async () => {
    const merged = await collectTools([
      src("first", { dup: { tag: "first" } as never }),
      src("second", { dup: { tag: "second" } as never }),
    ]);
    expect((merged.dup as unknown as { tag: string }).tag).toBe("first");
  });

  it("awaits async sources", async () => {
    const asyncSource: ToolSource = {
      name: "async",
      tools: async () => ({ z: {} as never }),
    };
    expect(Object.keys(await collectTools([asyncSource]))).toEqual(["z"]);
  });
});
