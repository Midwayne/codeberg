import type { DurableJobQueue } from '../queue.js';

/** The stable daily key survives restarts; missed days do not create a backlog of model calls. */
export async function scheduleDailyDreaming(
  queue: DurableJobQueue,
  now: Date = new Date(),
): Promise<void> {
  await queue.enqueueDreaming(`dream-daily-${now.toISOString().slice(0, 10)}`);
}

export function isDailyDreaming(id: string): boolean {
  return id.startsWith('dream-daily-');
}
