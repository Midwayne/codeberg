import { chunkKey, type SearchResult } from './types.js';

/**
 * A running ledger of code the agent has already retrieved this conversation,
 * injected as a compact block so the model reasons over prior findings instead
 * of re-issuing the same searches every turn — "best info at the ready" without
 * re-paying for the full snippets. Deduped by chunk id and bounded so the
 * ledger itself never crowds out the context window.
 */
export class EvidenceLedger {
  // Insertion-ordered: a Map preserves first-seen order, newest at the end.
  // Keyed by (repo, id): chunk ids restart at 1 per repo, so the bare id
  // would collapse distinct hits from different repos in --all runs.
  private readonly seen = new Map<string, SearchResult>();
  private readonly max: number;

  constructor(max = 40) {
    this.max = max;
  }

  add(results: readonly SearchResult[]): void {
    for (const r of results) {
      const key = chunkKey(r);
      if (!this.seen.has(key)) {
        this.seen.set(key, r);
      }
    }
  }

  get size(): number {
    return this.seen.size;
  }

  /** One line per chunk ([repo] path:lines symbol), most recent first. Bounded
   *  to `max` rows. Returns null when empty so callers can skip injection. */
  render(): string | null {
    if (this.seen.size === 0) {
      return null;
    }
    const rows = [...this.seen.values()]
      .slice(-this.max)
      .reverse()
      .map((r) => {
        const repo = r.repo ? `[${r.repo}] ` : '';
        const sym = r.symbol ? ` ${r.symbol}` : '';
        return `- ${repo}${r.path}:${r.start_line}-${r.end_line}${sym}`;
      });
    return (
      '<evidence_ledger>\n' +
      'Code already retrieved this conversation ' +
      '(reference it directly; search again only if you need fresh content):\n' +
      rows.join('\n') +
      '\n</evidence_ledger>'
    );
  }
}
