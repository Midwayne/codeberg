import type { RetrievedResult } from '../types.js';

export function collectResults(
  tool: string,
  output: unknown,
  results: RetrievedResult[],
  files: Set<string>,
  symbols: Set<string>,
  searchQuery?: string,
  toolCallId?: string,
): void {
  const candidates = resultCandidates(output);
  for (let rank = 0; rank < candidates.length; rank++) {
    const item = candidates[rank];
    const path = string(item.path ?? item.file);
    const symbol = string(item.symbol ?? item.name);
    if (!path && !symbol) continue;

    if (path) files.add(path);

    if (symbol) symbols.add(symbol);

    results.push({
      tool,
      ...(toolCallId ? { tool_call_id: toolCallId } : {}),
      rank: rank + 1,
      ...(number(item.score) !== undefined ? { score: number(item.score) } : {}),
      ...(string(item.repo) ? { repo: string(item.repo) } : {}),
      ...(path ? { path } : {}),
      ...(searchQuery ? { search_query: searchQuery } : {}),
      ...(symbol ? { symbol } : {}),
      ...(number(item.start_line ?? item.startLine) !== undefined
        ? { start_line: number(item.start_line ?? item.startLine) }
        : {}),
      ...(number(item.end_line ?? item.endLine) !== undefined
        ? { end_line: number(item.end_line ?? item.endLine) }
        : {}),
      ...(string(item.snippet ?? item.body)
        ? { snippet: string(item.snippet ?? item.body)?.slice(0, 2_000) }
        : {}),
    });
  }
}

export function resultCandidates(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);

  if (!isRecord(value)) return [];

  for (const key of ['results', 'hits', 'chunks', 'matches', 'references']) {
    if (Array.isArray(value[key])) return value[key].filter(isRecord);
  }

  return [value];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function string(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

export function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
