import type { LearningServiceState } from './state.js';

export async function syncWatcher(state: LearningServiceState): Promise<void> {
  if (state.knowledgeEnabled && state.preferences.knowledgeRefresh && !state.stopping)
    await state.sourceWatcher.sync();
}

// Durable writes can precede initialize. Starting a worker during replay can
// complete a job before reconciliation sees it and enqueue the same job twice.
export function wakeWorker(state: LearningServiceState): void {
  if (state.initialized) state.worker?.wake();
}
