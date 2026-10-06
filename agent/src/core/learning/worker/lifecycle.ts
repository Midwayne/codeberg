import { withProjectLog, writeModuleLog } from '../../module-log.js';
import { drain } from './execution.js';
import { scheduleRetry } from './policy.js';
import type { KnowledgeWorkerState } from './state.js';

export async function initialize(state: KnowledgeWorkerState): Promise<void> {
  await state.queue.recoverExpired();
  await state.queue.recoverRetryableFailures();
  wake(state);
}

export function wake(state: KnowledgeWorkerState): void {
  if (state.stopping || state.paused || state.running) return;

  if (state.retryTimer) clearTimeout(state.retryTimer);

  state.retryTimer = undefined;
  state.running = runUntilIdle(state)
    .catch((error: unknown) => {
      console.error('knowledge worker queue error:', error);
      writeModuleLog('learning-agent', 'queue_failed', { error: String(error) });
    })
    .finally(() => {
      state.running = undefined;
      if (!state.stopping)
        void scheduleRetry(state).catch((error: unknown) => {
          console.error('knowledge worker retry scheduling error:', error);
          writeModuleLog('learning-agent', 'retry_scheduling_failed', { error: String(error) });
        });
    });
}

export function stop(state: KnowledgeWorkerState): void {
  state.stopping = true;
  if (state.retryTimer) clearTimeout(state.retryTimer);

  state.retryTimer = undefined;
}

export function isRunning(state: KnowledgeWorkerState): boolean {
  return Boolean(state.running);
}

export function isProcessing(state: KnowledgeWorkerState): boolean {
  return state.processing;
}

export function pause(state: KnowledgeWorkerState): void {
  state.paused = true;
}

export function resume(state: KnowledgeWorkerState): void {
  state.paused = false;
  wake(state);
}

export async function waitForCurrent(state: KnowledgeWorkerState): Promise<void> {
  await state.running;
}

export function runUntilIdle(state: KnowledgeWorkerState): Promise<void> {
  return withProjectLog(state.logDir, () => drain(state));
}
