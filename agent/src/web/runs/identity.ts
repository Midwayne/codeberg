import { createHash } from 'node:crypto';
import type { RunStatus } from '../../core/api/runs.js';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** The id admission, lookup, and stop-by-request all derive from one chat submission. */
export function searchRunId(chatId: string, requestId: string): string {
  return sha256(`${chatId}:${requestId}`).slice(0, 32);
}

/** A person stopped the run. Anything else that aborts it is a failure. */
export const STOP_REQUEST = 'stop';

/** The process is shutting down; the run can be resumed rather than failed. */
export const SHUTDOWN_REQUEST = 'shutdown';

export type ControlledStop = typeof STOP_REQUEST | typeof SHUTDOWN_REQUEST;

export function abortControlled(controller: AbortController, reason: ControlledStop): void {
  controller.abort(reason);
}

/** Map an abort to a run status. Unknown reasons stay failures so a typo cannot look like a stop. */
export function statusAfterAbort(aborted: boolean, reason: unknown): RunStatus {
  if (!aborted) return 'failed';

  if (reason === SHUTDOWN_REQUEST) return 'interrupted';

  if (reason === STOP_REQUEST) return 'stopped';

  return 'failed';
}
