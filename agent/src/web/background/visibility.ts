import type { ScheduleSummary } from '../../core/schedules/summary.js';
import type { SearchRuns } from '../runs/manager.js';
import { SUBAGENT_TOOL_NAMES } from '../../core/subagents/names.js';
import { isValidSessionId } from '../sessions/records.js';
import { BackgroundError } from './store.js';

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
export async function subagentProgress(runs: SearchRuns, chatId: string, id: string) {
  if (!isValidSessionId(chatId) || !/^[a-f0-9]{32}$/.test(id)) return undefined;

  const job = await runs.background.get(chatId, id).catch((error: unknown) => {
    if (error instanceof BackgroundError && error.status === 404) return undefined;

    throw error;
  });
  if (!job || !SUBAGENT_TOOL_NAMES.includes(job.tool)) return undefined;

  const value = (job.output ?? job.progress) as { results?: unknown } | undefined;

  return { id, status: job.status, error: job.error, results: Array.isArray(value?.results) ? value.results : [] };
}
