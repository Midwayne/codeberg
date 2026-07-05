import type { SearchResult } from './types.js';

/** Parse `lines: "10-20"` (search_code compact shape) or numeric start/end. */
export function parseLineRange(
  lines: unknown,
  startLine?: unknown,
  endLine?: unknown,
): { start_line: number; end_line: number } {
  if (typeof lines === 'string' && lines.length > 0) {
    const range = /^(\d+)-(\d+)$/.exec(lines.trim());
    if (range) {
      return { start_line: Number(range[1]), end_line: Number(range[2]) };
    }
    const one = Number(lines);
    if (Number.isFinite(one) && one > 0) {
      return { start_line: one, end_line: one };
    }
  }
  const start = Number(startLine ?? 0);
  const end = Number(endLine ?? start);
  return { start_line: start, end_line: end };
}

/** Normalize daemon or compact tool hit shapes into SearchResult. */
export function normalizeSearchHit(raw: unknown): SearchResult | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const path = typeof r.path === 'string' ? r.path : '';
  if (!path) {
    return null;
  }
  const { start_line, end_line } = parseLineRange(r.lines, r.start_line, r.end_line);
  return {
    id: Number(r.id ?? 0),
    ...(typeof r.repo === 'string' && r.repo ? { repo: r.repo } : {}),
    path,
    symbol: typeof r.symbol === 'string' ? r.symbol : '',
    start_line,
    end_line,
    score: Number(r.score ?? 1),
    snippet:
      typeof r.snippet === 'string'
        ? r.snippet
        : typeof r.body === 'string'
          ? r.body.slice(0, 400)
          : '',
  };
}
