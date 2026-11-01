import { createHash } from 'node:crypto';
import type { SearchRuns } from './manager.js';
import { RunError } from './types.js';

/** Remember early Stops so a request still being read cannot start afterward. */
export class RunStops {
  private readonly requested = new Set<string>();

  check(id: string): void {
    if (this.requested.has(id)) throw new RunError(409, 'This submission was stopped. Send a new prompt to continue.');
  }

  async stop(runs: Pick<SearchRuns, 'find'>, admission: Promise<unknown> | undefined,
    chatId: string, id: string, byRequest: boolean): Promise<void> {
    if (byRequest) {
      id = createHash('sha256').update(`${chatId}:${id}`).digest('hex').slice(0, 32);
      this.requested.add(id);
    }

    await admission?.catch(() => undefined);
    const run = await runs.find(chatId, id);
    if (!run) {
      if (byRequest) return;

      throw new RunError(404, 'search run not found');
    }

    if (!run.settled) run.controller.abort('stop');
    await run.done;
  }
}
