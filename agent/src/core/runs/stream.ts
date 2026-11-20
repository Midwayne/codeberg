import { onAbort } from '../abort.js';
import type { ToolJournalContext, ToolObservation } from './tools.js';

type Base = Pick<ToolObservation, 'kind' | 'id' | 'name'>;
type Outcome = Pick<ToolObservation, 'state' | 'output' | 'error'>;

const ABANDONED = 'stopped before it finished';

/**
 * Record a streaming tool call: progress passes through, and the final value
 * is the recorded outcome. The call joins `context.pending` at once and
 * leaves it when an outcome is durable: completion, failure, the consumer
 * abandoning the stream, or the run aborting while the stream is suspended.
 */
export function recordedStream(
  context: ToolJournalContext,
  base: Base,
  input: unknown,
  stream: () => AsyncIterable<unknown>,
  abortSignal?: AbortSignal,
): AsyncIterable<unknown> {
  let outcome: Promise<void> | undefined;
  let settle!: () => void;
  const settled = new Promise<void>((resolve) => (settle = resolve));

  // Only the first outcome is recorded; later ones are no-ops.
  const finish = (entry: Outcome): Promise<void> => {
    outcome ??= context.append({ ...base, ...entry }).finally(settle);

    return outcome;
  };
  context.pending.add(settled);
  void settled.then(() => context.pending.delete(settled));
  const removeAbort = onAbort(abortSignal, () => void finish({ state: 'failed', error: ABANDONED }).catch(() => undefined));

  return passThrough(context, base, input, stream, finish, {
    finished: () => outcome !== undefined,
    cleanup: removeAbort,
  });
}

async function* passThrough(
  context: ToolJournalContext,
  base: Base,
  input: unknown,
  stream: () => AsyncIterable<unknown>,
  finish: (entry: Outcome) => Promise<void>,
  hooks: { finished: () => boolean; cleanup: () => void },
): AsyncGenerator<unknown> {
  try {
    // Already closed (the run was stopped before the stream was pulled): start nothing.
    if (hooks.finished()) return;

    await context.append({ ...base, state: 'started', input });

    let output: unknown;
    try {
      for await (const item of stream()) {
        output = item;
        yield item;
      }
    } catch (error) {
      await finish({ state: 'failed', error: String(error) });
      throw error;
    }

    await finish({ state: 'completed', output });
  } finally {
    hooks.cleanup();
    // The consumer returned early (or started nothing): close the call as unfinished.
    await finish({ state: 'failed', error: ABANDONED });
  }
}
