import { MESSAGE_TOOL, SUBAGENT_TOOL_NAMES } from '@agent/core/subagents/names.js';
import type { SubagentReport } from '@agent/core/subagents/run.js';

export type SubagentStatus = SubagentReport['status'];

/** One subagent as the chat shows it: its brief plus the latest progress or report. */
export interface SubagentRow {
  key: string;
  description: string;
  agentType: string;
  status: SubagentStatus;
  brief?: string;
  activity?: string;
  report?: string;
  error?: string;
  toolCalls: number;
  steps?: number;
  elapsedMs?: number;
  /** Epoch ms the subagent started, while it runs; the chat ticks its own clock from it. */
  startedAt?: number;
  usage?: SubagentReport['usage'];
  transcript?: string;
}

export interface SubagentView {
  title: string;
  summary: string;
  running: boolean;
  rows: SubagentRow[];
}

type Part = { type: string; toolName?: string; state?: string; input?: unknown; output?: unknown; errorText?: string };

type Brief = { description?: string; prompt?: string; agent_type?: string };

export function isSubagentTool(name: string): boolean {
  return SUBAGENT_TOOL_NAMES.includes(name);
}

/**
 * A follow-up refused before any subagent ran (for example, an unknown
 * agent_id). The agent recovers on its own, so it folds with other tool calls
 * instead of showing as a failed subagent card.
 */
export function isRejectedFollowUp(name: string, part: Part): boolean {
  return name === MESSAGE_TOOL && part.state === 'output-error' && resultsOf(part.output).length === 0;
}

/** What a run_subagents / message_subagent call looks like right now. */
export function subagentView(name: string, part: Part): SubagentView {
  const followUp = name === MESSAGE_TOOL;
  const briefs = followUp ? [followUpBrief(part.input)] : tasksOf(part.input);
  const results = resultsOf(part.output);
  const failed = part.state === 'output-error';
  const running = !failed && (part.state !== 'output-available' || (part as { preliminary?: boolean }).preliminary === true);

  const count = Math.max(briefs.length, results.length);
  const rows = Array.from({ length: count }, (_, index) =>
    rowOf(index, briefs[index], results[index], failed ? part.errorText ?? 'stopped' : undefined));

  return { title: titleOf(followUp, running, results.length > 0, count), summary: summaryOf(rows, running), running, rows };
}

function rowOf(index: number, brief: Brief | undefined, result: SubagentReport | undefined, failure?: string): SubagentRow {
  const unfinished = !result || result.status === 'queued' || result.status === 'running';

  return {
    // Keyed by position, which never changes, so a row keeps its open state when its agent id arrives.
    key: `task-${index}`,
    description: result?.description ?? brief?.description ?? `Subagent ${index + 1}`,
    agentType: result?.agent_type ?? brief?.agent_type ?? 'explorer',
    status: failure && unfinished ? 'failed' : (result?.status ?? 'queued'),
    brief: brief?.prompt,
    activity: result?.activity,
    report: result?.report,
    error: failure && unfinished ? failure : result?.error,
    toolCalls: result?.tool_calls ?? 0,
    steps: result?.steps,
    elapsedMs: result?.elapsed_ms,
    startedAt: result?.started_at,
    usage: result?.usage,
    transcript: result?.transcript,
  };
}

function titleOf(followUp: boolean, running: boolean, started: boolean, count: number): string {
  const noun = `${count} subagent${count === 1 ? '' : 's'}`;

  if (followUp) return running ? 'Asking a subagent a follow-up' : 'Subagent follow-up';

  if (!running) return `${noun} finished`;

  return started ? `Running ${noun}` : `Starting ${noun}`;
}

function summaryOf(rows: SubagentRow[], running: boolean): string {
  const count = (status: SubagentStatus) => rows.filter((row) => row.status === status).length;
  const finished = rows.length - count('queued') - count('running');

  if (running) return `${finished} of ${rows.length} done`;

  const calls = rows.reduce((total, row) => total + row.toolCalls, 0);
  const parts = [
    `${count('completed')} done`,
    count('incomplete') ? `${count('incomplete')} incomplete` : '',
    count('failed') ? `${count('failed')} failed` : '',
    `${calls} tool call${calls === 1 ? '' : 's'}`,
  ];

  return parts.filter(Boolean).join(' · ');
}

function tasksOf(input: unknown): Brief[] {
  const tasks = (input as { tasks?: unknown } | undefined)?.tasks;

  return Array.isArray(tasks) ? tasks.filter((task): task is Brief => Boolean(task) && typeof task === 'object') : [];
}

function followUpBrief(input: unknown): Brief {
  const message = (input as { message?: unknown } | undefined)?.message;

  return { description: 'Follow-up', prompt: typeof message === 'string' ? message : undefined };
}

function resultsOf(output: unknown): SubagentReport[] {
  const results = (output as { results?: unknown } | undefined)?.results;

  return Array.isArray(results) ? (results as SubagentReport[]) : [];
}
