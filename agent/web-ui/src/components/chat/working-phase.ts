import { isToolUIPart, type UIMessage } from 'ai';

export type WorkingPhase = { kind: 'waiting' | 'reasoning' | 'tool'; label: string };

/* Shown while the model has not yet picked a tool or started reasoning. */
export const waitingLabels = [
  'Thinking',
  'Reading your question',
  'Planning the search',
  'Tracing call paths',
  'Following imports',
  'Connecting the dots',
  'Weighing the evidence',
  'Untangling dependencies',
];

const toolLabels: Record<string, string> = {
  grep: 'Searching the code',
  glob: 'Finding files',
  search: 'Searching the index',
  search_code: 'Searching the index',
  hybrid_search: 'Searching the index',
  search_bundle: 'Searching the index',
  search_graph: 'Exploring the code graph',
  search_knowledge: 'Checking saved knowledge',
  read_file: 'Reading files',
  get_chunk: 'Reading files',
  head: 'Reading files',
  sed: 'Reading files',
  file_outline: 'Outlining a file',
  find_symbol: 'Locating a symbol',
  find_references: 'Finding references',
  trace_path: 'Tracing a call path',
  get_architecture: 'Mapping the architecture',
  list_dir: 'Browsing directories',
  tree: 'Browsing directories',
  git_log: 'Reading history',
  git_blame: 'Reading history',
  detect_changes: 'Checking recent changes',
  batch: 'Running several tools',
  browser_task: 'Browsing the web',
  web: 'Browsing the web',
};

export function toolLabel(name: string): string {
  return toolLabels[name] ?? 'Using a tool';
}

/* Rotate the waiting label, offset by turn so consecutive turns start differently. */
export function waitingLabel(turn: number, tick: number): string {
  return waitingLabels[(turn + tick) % waitingLabels.length]!;
}

export function workingPhase(messages: UIMessage[], tick: number): WorkingPhase {
  const latest = messages.at(-1);
  const turn = messages.filter((message) => message.role === 'user').length;

  const waiting: WorkingPhase = { kind: 'waiting', label: waitingLabel(turn, tick) };
  if (latest?.role !== 'assistant') return waiting;

  const part = latest.parts.at(-1);
  if (part && isToolUIPart(part) && part.state !== 'output-available' && part.state !== 'output-error') {
    const name = part.type === 'dynamic-tool' ? part.toolName : part.type.slice('tool-'.length);
    return { kind: 'tool', label: toolLabel(name) };
  }

  if (part?.type === 'reasoning' && part.state === 'streaming') return { kind: 'reasoning', label: 'Reasoning' };

  return waiting;
}

/* Elapsed time stays hidden for quick turns, then reads like "12s" or "1m 05s". */
export function formatElapsed(seconds: number): string {
  if (seconds < 3) return '';
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, '0');

  return `${minutes}m ${rest}s`;
}
