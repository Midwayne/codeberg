import type { UIMessageChunk } from 'ai';
import type { SearchRun } from './types.js';

export function notify(run: SearchRun): void {
  for (const wake of run.listeners) wake();

  run.listeners.clear();
}

/** A disconnected reader relinquishes only its subscription, never the search run. */
export function runStream(run: SearchRun, after: number): ReadableStream<UIMessageChunk> {
  let cursor = after;
  let cancelled = false;
  let wake: (() => void) | undefined;

  return new ReadableStream({
    async pull(controller) {
      while (!cancelled && cursor >= run.events.length && !run.settled) {
        await new Promise<void>((resolve) => {
          wake = resolve;
          run.listeners.add(resolve);
        });
      }
      if (cancelled) return;

      if (cursor < run.events.length) controller.enqueue(run.events[cursor++]);
      else controller.close();
    },
    cancel() {
      cancelled = true;
      if (wake) {
        run.listeners.delete(wake);
        wake();
      }
    },
  });
}

export async function publish(run: SearchRun, chunk: UIMessageChunk): Promise<void> {
  if (chunk.type === 'start' && !chunk.messageId) chunk = { ...chunk, messageId: run.record.id };

  await run.journal.append({ kind: 'chunk', chunk });
  run.events.push(chunk);
  notify(run);
}
