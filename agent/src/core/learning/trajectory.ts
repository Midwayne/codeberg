import type { UIMessage } from 'ai';

import type { RetrievedResult, ToolInvocation, TrajectoryStep } from './types.js';
import { redactSecrets } from './redact.js';

interface Trajectory {
  answer: string;
  searchQueries: string[];
  retrievedResults: RetrievedResult[];
  filesInspected: string[];
  symbolsInspected: string[];
  toolsInvoked: ToolInvocation[];
  evidenceUsed: RetrievedResult[];
  steps: TrajectoryStep[];
  openedFiles: string[];
}

export function messageText(message: UIMessage): string {
  return message.parts
    .filter(
      (part): part is Extract<UIMessage['parts'][number], { type: 'text' }> => part.type === 'text',
    )
    .map((part) => part.text)
    .join('\n\n');
}

export function extractTrajectory(message: UIMessage): Trajectory {
  const answer = messageText(message);
  const state: TrajectoryState = {
    searchQueries: new Set(),
    files: new Set(),
    symbols: new Set(),
    openedFiles: new Set(),
    toolsInvoked: [],
    retrievedResults: [],
    steps: [],
  };

  for (const part of message.parts as unknown as Record<string, unknown>[]) {
    const invocation = toolInvocation(part);
    if (invocation) recordInvocation(state, invocation);
  }

  return finishTrajectory(answer, state);
}

interface TrajectoryState {
  searchQueries: Set<string>;
  files: Set<string>;
  symbols: Set<string>;
  openedFiles: Set<string>;
  toolsInvoked: ToolInvocation[];
  retrievedResults: RetrievedResult[];
  steps: TrajectoryStep[];
  lastQuery?: string;
}

function recordInvocation(state: TrajectoryState, invocation: ToolInvocation): void {
  const { name, input, output, timestamp, tool_call_id: toolCallId } = invocation;
  state.toolsInvoked.push(invocation);
  state.steps.push({
    kind: 'tool_call',
    tool: name,
    tool_call_id: toolCallId,
    payload: input,
    timestamp,
  });
  if (output !== undefined)
    state.steps.push({
      kind: 'observation',
      tool: name,
      tool_call_id: toolCallId,
      payload: output,
      timestamp,
    });

  collectInput(name, input, state.searchQueries, state.files, state.symbols);
  if (/open|read_file|read_source/i.test(name) && input && typeof input === 'object') {
    const file = (input as Record<string, unknown>).path ?? (input as Record<string, unknown>).file;
    if (typeof file === 'string') state.openedFiles.add(file);
  }

  if (/search|grep|references|symbol/i.test(name) && input && typeof input === 'object') {
    const record = input as Record<string, unknown>;
    const query = record.query ?? record.pattern ?? record.name;
    if (typeof query === 'string') state.lastQuery = query;
  }

  collectResults(
    name,
    output,
    state.retrievedResults,
    state.files,
    state.symbols,
    /search|grep|references|symbol/i.test(name) ? state.lastQuery : undefined,
    toolCallId,
  );
}

function finishTrajectory(answer: string, state: TrajectoryState): Trajectory {
  const evidenceUsed = state.retrievedResults.filter((result) =>
    Boolean(
      (result.path && answer.includes(result.path)) ||
        (result.symbol && answer.includes(result.symbol)),
    ),
  );

  return {
    answer,
    searchQueries: [...state.searchQueries],
    retrievedResults: state.retrievedResults,
    filesInspected: [...state.files],
    symbolsInspected: [...state.symbols],
    toolsInvoked: state.toolsInvoked,
    evidenceUsed,
    steps: [...state.steps, { kind: 'answer', text: redactSecrets(answer) }],
    openedFiles: [...state.openedFiles],
  };
}

function toolInvocation(part: Record<string, unknown>): ToolInvocation | undefined {
  const type = typeof part.type === 'string' ? part.type : '';
  if (type !== 'dynamic-tool' && !type.startsWith('tool-')) return undefined;

  const name =
    typeof part.toolName === 'string'
      ? part.toolName
      : type.startsWith('tool-')
        ? type.slice('tool-'.length)
        : 'unknown';

  const input = redactSecrets(part.input);
  const output = redactSecrets(part.output);
  const timestamp = typeof part.timestamp === 'string' ? part.timestamp : undefined;
  const toolCallId = typeof part.toolCallId === 'string' ? part.toolCallId : undefined;
  const state = typeof part.state === 'string' ? part.state : undefined;

  return {
    name,
    tool_call_id: toolCallId,
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
    timestamp,
    state,
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
