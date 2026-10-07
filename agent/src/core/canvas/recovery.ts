import { AsyncLocalStorage } from 'node:async_hooks';
import { CanvasRevisionConflict } from './types.js';

const recovery = new AsyncLocalStorage<{ conflicts: number }>();
const MAX_CONFLICTS = 3;
const stop = 'Stop canvas mutations for this turn. Keep the saved drawing and continue in text; briefly explain that concurrent edits prevented saving.';

/** A fresh budget per turn, isolated even when chats share pooled tools. */
export function withCanvasRecovery<T>(action: () => T): T {
  return recovery.run({ conflicts: 0 }, action);
}

export function mutationProblem(revision: unknown) {
  if ((recovery.getStore()?.conflicts ?? 0) >= MAX_CONFLICTS) {
    return { error: 'Canvas kept changing. Your saved edits are preserved.',
      code: 'CANVAS_RETRY_LIMIT', retryable: false, applied: false, recovery: stop };
  }
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
    return { error: 'Read canvas_get and supply its revision before changing the canvas.',
      code: 'CANVAS_REVISION_REQUIRED', applied: false };
  }
  return undefined;
}

export function conflictResult(error: CanvasRevisionConflict) {
  const state = recovery.getStore();
  if (state) state.conflicts++;

  const retryable = (state?.conflicts ?? 1) < MAX_CONFLICTS;
  return { error: retryable ? 'Canvas changed before this edit could be saved.' : 'Canvas kept changing. Your saved edits are preserved.',
    code: 'CANVAS_REVISION_CONFLICT', status: error.status, applied: false, retryable,
    expectedRevision: error.expectedRevision, currentRevision: error.currentRevision,
    recovery: retryable
      ? 'Read canvas_get again, inspect all affected elements and connections, and rebuild only the changes still needed around the latest user edits. Do not just replace the revision or replay a stale patch. If another conflict occurs, reread and reassess again. Stop when retryable is false.'
      : stop };
}
