import { describe, expect, it } from "vitest";

import { EvidenceLedger } from "./evidence.js";
import type { SearchResult } from "./types.js";

function hit(id: number, path: string, symbol = ""): SearchResult {
  return {
    id,
    path,
    symbol,
    start_line: 1,
    end_line: 9,
    score: 1,
    snippet: "",
  };
}

describe("EvidenceLedger", () => {
  it("is empty until something is added", () => {
    const ledger = new EvidenceLedger();
    expect(ledger.size).toBe(0);
    expect(ledger.render()).toBeNull();
  });

  it("dedupes by chunk id across adds", () => {
    const ledger = new EvidenceLedger();
    ledger.add([hit(1, "a.go"), hit(2, "b.go")]);
    ledger.add([hit(1, "a.go"), hit(3, "c.go")]);
    expect(ledger.size).toBe(3);
  });

  it("renders one cited line per chunk, most recent first", () => {
    const ledger = new EvidenceLedger();
    ledger.add([hit(1, "a.go", "Foo"), hit(2, "b.go")]);
    const out = ledger.render()!;
    expect(out).toContain("<evidence_ledger>");
    expect(out.indexOf("b.go:1-9")).toBeLessThan(out.indexOf("a.go:1-9 Foo"));
  });

  it("bounds the rendered rows to its max", () => {
    const ledger = new EvidenceLedger(2);
    ledger.add([hit(1, "a"), hit(2, "b"), hit(3, "c")]);
    const rows = ledger.render()!.split("\n").filter((l) => l.startsWith("- "));
    expect(rows).toHaveLength(2);
  });
});
