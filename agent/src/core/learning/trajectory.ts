import type { UIMessage } from 'ai';
import { collectResults } from './trajectory/results.js';

import { redactSecrets } from './redact.js';
import type { RetrievedResult, ToolInvocation, TrajectoryStep } from './types.js';

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
