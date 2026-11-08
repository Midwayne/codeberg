import { scheduleDailyDreaming } from '../dreaming/scheduler.js';
import { wakeWorker } from './background.js';
import type { LearningServiceState } from './state.js';

/** Stable UTC date keys make daily requests durable and idempotent after restart. */
export async function scheduleDreaming(state: LearningServiceState): Promise<void> {
  if (!state.preferences.dreaming || !state.knowledgeEnabled || state.stopping || state.maintenance)
    return;

  await scheduleDailyDreaming(state.queue);
  wakeWorker(state);
}
