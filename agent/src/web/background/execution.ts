import type { BackgroundExecute, BackgroundJob, ReleaseBackground } from '../../core/background/types.js';
import { toolJournal } from '../../core/runs/tools.js';
import type { BackgroundStore } from './store.js';

export function onceRelease(release?: ReleaseBackground): ReleaseBackground {
  let released = false;

  return async () => {
    if (released) return;

    released = true;
    await release?.();
  };
}

export async function executeBackground(job: BackgroundJob, execute: BackgroundExecute, signal: AbortSignal,
  store: BackgroundStore, closed: () => boolean, release: ReleaseBackground): Promise<void> {
  try {
    const output = await toolJournal.exit(() => collect(execute(signal), async (progress) => {
      await store.serial(async () => {
        if (closed()) return;

        job.progress = progress;
        await store.write(job);
      });
    }));
    await store.serial(async () => {
      if (closed()) return;

      job.output = output;
      delete job.progress;
      job.status = signal.aborted ? 'cancelled' : 'completed';
      job.finishedAt = Date.now();
      await store.write(job);
    });
  } catch (error) {
    await store.serial(async () => {
      if (closed()) return;

      delete job.output;
      delete job.progress;
      job.status = signal.aborted ? 'cancelled' : 'failed';
      job.error = String(error);
      job.finishedAt = Date.now();
      await store.write(job);
    });
  } finally {
    await release();
  }
}

async function collect(value: unknown, progress: (value: unknown) => Promise<void>): Promise<unknown> {
  const resolved = await value;
  if (!resolved || typeof resolved !== 'object' || !(Symbol.asyncIterator in resolved)) return resolved;

  let latest: unknown;
  for await (const item of resolved as AsyncIterable<unknown>) {
    latest = item;
    await progress(item);
  }

  return latest;
}
