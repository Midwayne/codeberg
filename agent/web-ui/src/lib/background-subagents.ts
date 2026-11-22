import type { SubagentReport } from '@agent/core/subagents/run.js';

import { ensureOk } from './http';
import { isSubagentTool } from './subagents';

type Part = { type: string; state?: string; input?: unknown; output?: unknown };

/** A detached subagent run as the server reports it: the job's status and its latest rows. */
export interface SubagentProgress {
  status: string;
  error?: string;
  results: SubagentReport[];
}

export interface DetachedSubagents {
  name: string;
  jobId: string;
  args: unknown;
}

const FAILED_LABEL: Record<string, string> = { failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted' };

/** `start_background_tool` running run_subagents / message_subagent, once the job exists. */
export function detachedSubagents(name: string, part: Part): DetachedSubagents | undefined {
  if (name !== 'start_background_tool' || part.state !== 'output-available') return undefined;

  const input = part.input as { tool?: unknown; args?: unknown } | undefined;
  const jobId = (part.output as { id?: unknown } | undefined)?.id;

  if (typeof input?.tool !== 'string' || !isSubagentTool(input.tool) || typeof jobId !== 'string') return undefined;

  return { name: input.tool, jobId, args: input.args };
}

/** `background_tool_status` for one subagent job, shown as the run it reports on. */
export function statusSubagents(name: string, part: Part): { name: string; part: Part } | undefined {
  if (name !== 'background_tool_status' || part.state !== 'output-available') return undefined;

  const job = part.output as { tool?: unknown; args?: unknown; status?: unknown; error?: unknown; output?: unknown; progress?: unknown };
  if (!job || typeof job !== 'object' || Array.isArray(job)) return undefined;

  if (typeof job.tool !== 'string' || !isSubagentTool(job.tool) || typeof job.status !== 'string') return undefined;

  const results = resultsOf(job.output) ?? resultsOf(job.progress) ?? [];
  const error = typeof job.error === 'string' ? job.error : undefined;

  return { name: job.tool, part: progressPart(job.args, { status: job.status, error, results }) };
}

/** A tool part the subagent card reads: live while the job runs, final once it settles. */
export function progressPart(args: unknown, progress: SubagentProgress | undefined): Part & Record<string, unknown> {
  const base = { type: 'tool-run_subagents', input: args };

  if (!progress) return { ...base, state: 'input-available' };

  const failure = FAILED_LABEL[progress.status];
  if (failure) return { ...base, state: 'output-error', output: progress, errorText: progress.error ?? failure };

  const running = progress.status === 'running' || progress.status === 'cancelling';

  return { ...base, state: 'output-available', preliminary: running, output: progress };
}

export function settled(progress: SubagentProgress | undefined): boolean {
  return Boolean(progress && progress.status !== 'running' && progress.status !== 'cancelling');
}

export async function loadSubagentProgress(api: typeof fetch, id: string, signal?: AbortSignal): Promise<SubagentProgress> {
  const response = await api(`/api/schedules/${encodeURIComponent(id)}/subagents`, { signal, cache: 'no-store' });
  await ensureOk(response, 'Could not load the background subagents.');

  const body = await response.json() as Partial<SubagentProgress>;
  if (!body || typeof body.status !== 'string' || !Array.isArray(body.results)) throw new Error('Invalid background subagent response.');

  return { status: body.status, error: body.error, results: body.results };
}

function resultsOf(value: unknown): SubagentReport[] | undefined {
  const results = (value as { results?: unknown } | undefined)?.results;

  return Array.isArray(results) ? results as SubagentReport[] : undefined;
}

/** Subagent runs (foreground, detached, or reported by status) and sleeps stay out of the folded tool group. */
export function staysVisible(name: string, part: Part): boolean {
  if (isSubagentTool(name)) return true;

  if (name === 'sleep_agent') return part.state !== 'output-error';

  return Boolean(detachedSubagents(name, part) ?? statusSubagents(name, part));
}
