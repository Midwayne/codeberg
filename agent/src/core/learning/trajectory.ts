import type { UIMessage } from 'ai';

import type { RetrievedResult, ToolInvocation } from './types.js';
import { redactSecrets } from './redact.js';

interface Trajectory {
  answer: string;
  searchQueries: string[];
  retrievedResults: RetrievedResult[];
  filesInspected: string[];
  symbolsInspected: string[];
  toolsInvoked: ToolInvocation[];
  evidenceUsed: RetrievedResult[];
}

export function messageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is Extract<UIMessage['parts'][number], { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n\n');
}

export function extractTrajectory(message: UIMessage): Trajectory {
  const answer = messageText(message);
  const searchQueries = new Set<string>();
  const files = new Set<string>();
  const symbols = new Set<string>();
  const toolsInvoked: ToolInvocation[] = [];
  const retrievedResults: RetrievedResult[] = [];

  for (const part of message.parts as unknown as Record<string, unknown>[]) {
    const type = typeof part.type === 'string' ? part.type : '';
    if (type !== 'dynamic-tool' && !type.startsWith('tool-')) continue;
    const name =
      typeof part.toolName === 'string'
        ? part.toolName
        : type.startsWith('tool-')
          ? type.slice('tool-'.length)
          : 'unknown';
    const input = redactSecrets(part.input);
    const output = redactSecrets(part.output);
    toolsInvoked.push({ name, ...(input !== undefined ? { input } : {}), ...(output !== undefined ? { output } : {}) });

    collectInput(name, input, searchQueries, files, symbols);
    collectResults(name, output, retrievedResults, files, symbols);
  }

  const evidenceUsed = retrievedResults.filter((result) =>
    Boolean((result.path && answer.includes(result.path)) || (result.symbol && answer.includes(result.symbol))),
  );
  return {
    answer,
    searchQueries: [...searchQueries],
    retrievedResults,
    filesInspected: [...files],
    symbolsInspected: [...symbols],
    toolsInvoked,
    evidenceUsed,
  };
}

function collectInput(
  name: string,
  input: unknown,
  searches: Set<string>,
  files: Set<string>,
  symbols: Set<string>,
): void {
  if (!input || typeof input !== 'object') return;
  const record = input as Record<string, unknown>;
  if (/search|grep|references|symbol/i.test(name)) {
    const query = record.query ?? record.pattern ?? record.name;
    if (typeof query === 'string' && query.trim()) searches.add(query.trim());
  }
  const path = record.path ?? record.file;
  if (typeof path === 'string') files.add(path);
  const symbol = record.symbol ?? (name.includes('symbol') ? record.name : undefined);
  if (typeof symbol === 'string') symbols.add(symbol);
}

function collectResults(
  tool: string,
  output: unknown,
  results: RetrievedResult[],
  files: Set<string>,
  symbols: Set<string>,
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
      rank: rank + 1,
      ...(number(item.score) !== undefined ? { score: number(item.score) } : {}),
      ...(string(item.repo) ? { repo: string(item.repo) } : {}),
      ...(path ? { path } : {}),
      ...(symbol ? { symbol } : {}),
      ...(number(item.start_line ?? item.startLine) !== undefined
        ? { start_line: number(item.start_line ?? item.startLine) }
        : {}),
      ...(number(item.end_line ?? item.endLine) !== undefined
        ? { end_line: number(item.end_line ?? item.endLine) }
        : {}),
      ...(string(item.snippet ?? item.body) ? { snippet: string(item.snippet ?? item.body)?.slice(0, 2_000) } : {}),
    });
  }
}

function resultCandidates(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ['results', 'hits', 'chunks', 'matches', 'references']) {
    if (Array.isArray(value[key])) return value[key].filter(isRecord);
  }
  return [value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
