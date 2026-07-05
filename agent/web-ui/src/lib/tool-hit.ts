export interface ToolHit {
  id?: number | string;
  repo?: string;
  path?: string;
  symbol?: string;
  lines?: string;
  start_line?: number;
  end_line?: number;
  score?: number;
  grep_boost?: number;
  snippet?: string;
  body?: string;
  kind?: string;
}

function parseLineRange(
  lines: unknown,
  startLine?: unknown,
  endLine?: unknown,
): { start_line?: number; end_line?: number; lines?: string } {
  if (typeof lines === 'string' && lines.length > 0) {
    const range = /^(\d+)-(\d+)$/.exec(lines.trim());
    if (range) {
      return {
        start_line: Number(range[1]),
        end_line: Number(range[2]),
        lines,
      };
    }
  }
  if (startLine != null) {
    const start = Number(startLine);
    const end = Number(endLine ?? startLine);
    return {
      start_line: start || undefined,
      end_line: end || undefined,
      lines: start > 0 ? `${start}-${end}` : undefined,
    };
  }
  if (typeof lines === 'string' && lines.length > 0) {
    return { lines };
  }
  return {};
}

export function normalizeToolHit(raw: unknown): ToolHit | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const path = typeof r.path === 'string' ? r.path : '';
  if (!path) return null;
  const range = parseLineRange(r.lines, r.start_line, r.end_line);
  return {
    id: r.id as number | string | undefined,
    repo: typeof r.repo === 'string' ? r.repo : undefined,
    path,
    symbol: typeof r.symbol === 'string' ? r.symbol : undefined,
    kind: typeof r.kind === 'string' ? r.kind : undefined,
    ...range,
    score: r.score != null ? Number(r.score) : undefined,
    snippet:
      typeof r.snippet === 'string'
        ? r.snippet
        : typeof r.body === 'string'
          ? r.body.slice(0, 400)
          : undefined,
  };
}
