import { writeModuleLog } from '../../module-log.js';
import { jobEnabled, syncWatcher } from './settings.js';
import type { LearningServiceState } from './state.js';

export function isWorking(state: LearningServiceState): boolean {
  return state.worker?.isRunning() ?? false;
}

export function isUpdating(state: LearningServiceState): boolean {
  return state.worker?.isProcessing() ?? false;
}

export async function activeJobs(state: LearningServiceState): Promise<number> {
  const now = Date.now();
  const [pending, processing] = await Promise.all([
    state.queue.list('pending'),
    state.queue.list('processing'),
  ]);

  return [
    ...pending.filter((job) => !job.next_attempt_at || Date.parse(job.next_attempt_at) <= now),
    ...processing,
  ].filter((job) => jobEnabled(state, job)).length;
}

export async function waitForCurrent(state: LearningServiceState): Promise<void> {
  await state.worker?.waitForCurrent();
  await syncWatcher(state);
}

export async function withMaintenance<T>(
  state: LearningServiceState,
  action: () => Promise<T>,
): Promise<T> {
  if (state.maintenance || isWorking(state) || state.checking) throw new Error('learning is busy');

  state.maintenance = true;
  state.worker?.pause();
  try {
    const pending = await state.queue.list('pending');
    if ((await activeJobs(state)) || pending.some((job) => jobEnabled(state, job)))
      throw new Error('learning is busy');

    return await action();
  } finally {
    state.maintenance = false;
    try {
      await syncWatcher(state);
    } catch (error) {
      writeModuleLog('learning-agent', 'watcher_update_failed', { error: String(error) });
    } finally {
      state.worker?.resume();
    }
  }
}
