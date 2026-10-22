import { publish } from './stream.js';
import { settleInterruptedEvents } from './terminal.js';
import type { SearchRun } from './types.js';

/** Loaded journals have no live owner, even if admission never saved a session pointer. */
export async function recoverInterruptedRun(run: SearchRun): Promise<void> {
  if (run.record.status !== 'running') return;

  run.record.status = 'interrupted';
  run.record.finishedAt = Date.now();
  run.record.error = 'Server restarted. Saved tool outcomes are preserved; unfinished calls have uncertain outcomes. Start a new search to continue.';
  await settleInterruptedEvents(run);
  await publish(run, { type: 'error', errorText: run.record.error });
  await run.journal.save(run.record);
}
