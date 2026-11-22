import { withCanvasChat } from '../../core/canvas/context.js';
import { backgroundContext, type BackgroundContext } from '../../core/background/context.js';
import { scheduleContext } from '../../core/schedules/context.js';
import type { SearchRuns } from './manager.js';
import type { SearchRun } from './types.js';

export function withRunScope(runs: SearchRuns, run: SearchRun, execute: () => Promise<void>): Promise<void> {
  const owner = { chatId: run.record.chatId, sourceRunId: run.record.id };
  const scope: BackgroundContext = { ...owner, jobs: runs.background, sleeping: false, signal: run.controller.signal };

  return withCanvasChat(owner.chatId, () => scheduleContext.run({ ...owner, scheduler: runs.schedules }, () =>
    backgroundContext.run(scope, async () => {
      try {
        await execute();
      } finally {
        if (scope.sleepWakeId && ['stopped', 'failed'].includes(run.record.status)) {
          await runs.schedules.cancel(owner.chatId, scope.sleepWakeId);
        }

        await withdrawWakeUps(runs, owner.chatId, scope.withdrawWakeIds ?? []);
      }
    })));
}

/** Wake-ups `sleep_agent` refused but could not cancel at the time; a failure here only logs. */
async function withdrawWakeUps(runs: SearchRuns, chatId: string, ids: string[]): Promise<void> {
  for (const id of ids) {
    await runs.schedules.cancel(chatId, id)
      .catch((error) => console.error(`Could not cancel a refused wake-up ${id}:`, error));
  }
}
