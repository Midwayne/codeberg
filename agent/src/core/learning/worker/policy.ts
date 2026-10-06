import { writeModuleLog } from '../../module-log.js';
import { isDailyDreaming } from '../dreaming/scheduler.js';
import type { KnowledgeJob } from '../types.js';
import { wake } from './lifecycle.js';
import type { KnowledgeWorkerState } from './state.js';

export function jobEnabled(state: KnowledgeWorkerState, job: KnowledgeJob): boolean {
  const settings = state.settings();
  if (!settings.enabled) return false;

  if (
    job.type === 'consolidate_knowledge' &&
    isDailyDreaming(job.interaction_id) &&
    !settings.dreaming
  )
    return false;

  return job.type === 'extract_dataset'
    ? settings.datasets && Object.values(settings.kinds).some(Boolean)
    : Boolean(state.generator) &&
        settings.knowledge &&
        Object.values(settings.categories).some(Boolean) &&
        (job.type === 'consolidate_knowledge' ||
          (job.source_refresh ? settings.knowledgeRefresh : settings.knowledgeCapture));
}

export function enabledType(
  state: KnowledgeWorkerState,
): 'extract_knowledge' | 'extract_dataset' | undefined | false {
  const settings = state.settings();
  if (!settings.enabled) return false;

  const knowledge =
    Boolean(state.generator) &&
    settings.knowledge &&
    Object.values(settings.categories).some(Boolean);

  const datasets = settings.datasets && Object.values(settings.kinds).some(Boolean);

  return knowledge ? undefined : datasets ? 'extract_dataset' : false;
}

export async function scheduleRetry(state: KnowledgeWorkerState): Promise<void> {
  if (state.stopping || state.paused) return;

  const type = enabledType(state);
  if (type === false) return;

  const due = await state.queue.nextDueAt(type, (job) => jobEnabled(state, job));
  if (due === undefined) return;

  // Timers use wall-clock time, while tests/queues may inject a different clock.
  const delay = Math.max(0, due - Date.now());
  state.retryTimer = setTimeout(() => {
    void state.queue
      .recoverExpired()
      .then(() => wake(state))
      .catch((error: unknown) => {
        console.error('knowledge worker recovery error:', error);
        writeModuleLog('learning-agent', 'recovery_failed', { error: String(error) });
        void scheduleRetry(state);
      });
  }, delay);
  state.retryTimer.unref();
}
