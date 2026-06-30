import type { SearchResult } from "./types.js";

/**
 * A running ledger of code the agent has already retrieved this conversation,
 * injected as a compact block so the model reasons over prior findings instead
 * of re-issuing the same searches every turn — "best info at the ready" without
 * re-paying for the full snippets. Deduped by chunk id and bounded so the
 * ledger itself never crowds out the context window.
 */
export class EvidenceLedger {
  // Insertion-ordered: a Map preserves first-seen order, newest at the end.
  private readonly seen = new Map<number, SearchResult>();
  private readonly max: number;

  constructor(max = 40) {
    this.max = max;
  }

  add(results: readonly SearchResult[]): void {
    for (const r of results) {
      if (!this.seen.has(r.id)) {
        this.seen.set(r.id, r);
      }
    }
  }

  get size(): number {
    return this.seen.size;
  }

  /** One line per chunk (path:lines symbol), most recent first. Bounded to
   *  `max` rows. Returns null when empty so callers can skip injection. */
  render(): string | null {
    if (this.seen.size === 0) {
      return null;
    }
    const rows = [...this.seen.values()]
      .slice(-this.max)
      .reverse()
      .map((r) => {
        const sym = r.symbol ? ` ${r.symbol}` : "";
        return `- ${r.path}:${r.start_line}-${r.end_line}${sym}`;
      });
    return (
      "<evidence_ledger>\n" +
      "Code already retrieved this conversation " +
      "(reference it directly; search again only if you need fresh content):\n" +
      rows.join("\n") +
      "\n</evidence_ledger>"
    );
  }
}
