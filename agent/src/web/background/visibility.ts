import type { ScheduleSummary } from '../../core/schedules/summary.js';
import type { SearchRuns } from '../runs/manager.js';

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
