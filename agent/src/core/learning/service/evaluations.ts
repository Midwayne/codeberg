import { writeModuleLog } from '../../module-log.js';
import { wakeWorker } from './settings.js';
import type { LearningServiceState } from './state.js';

/** Reconciliation failures cannot roll back an already durable review decision. */
export async function refreshEvaluations(state: LearningServiceState): Promise<void> {
  if (state.stopping || state.maintenance) return;

  try {
    await state.evaluations?.reconcile();
  } catch (error) {
    writeModuleLog('learning-agent', 'evaluation_schedule_failed', { error: String(error) });
  }

  wakeWorker(state);
}
