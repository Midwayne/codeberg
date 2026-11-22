import type { ScheduleSummary } from '../../core/schedules/summary.js';
import type { SearchRuns } from '../runs/manager.js';
import { SUBAGENT_TOOL_NAMES } from '../../core/subagents/names.js';

export async function backgroundSchedules(runs: SearchRuns): Promise<ScheduleSummary[]> {
  return Promise.all((await runs.background.listAll()).map(async (job) => {
    const session = await runs.sessions.load(job.chatId);
    const status = job.status === 'cancelling' ? 'running' : job.status === 'interrupted' ? 'failed' : job.status;

    return { id: job.id, chatId: job.chatId, chatTitle: session?.title ?? 'Deleted chat', chatDeleted: !session,
      kind: 'background' as const, backgroundStatus: job.status, prompt: job.tool, status,
      createdAt: job.createdAt, lastRunId: job.sourceRunId, error: job.error };
  }));
}

export async function cancelBackground(runs: SearchRuns, id: string) {
  const job = (await runs.background.listAll()).find((item) => item.id === id);
  if (!job) return undefined;

  const cancelled = await runs.background.cancel(job.chatId, id);

  return { id, kind: 'background', stopping: cancelled.status === 'cancelling' };
}

/** A detached subagent run's latest rows, or its final reports, for the chat card that started it. */
export async function subagentProgress(runs: SearchRuns, id: string) {
  const summary = (await runs.background.listAll()).find((item) => item.id === id);
  if (!summary || !SUBAGENT_TOOL_NAMES.includes(summary.tool)) return undefined;

  const job = await runs.background.get(summary.chatId, id);
  const value = (job.output ?? job.progress) as { results?: unknown } | undefined;

  return { id, status: job.status, error: job.error, results: Array.isArray(value?.results) ? value.results : [] };
}
