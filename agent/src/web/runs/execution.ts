import { browserConversation } from '../../core/browser/scope.js';
import { join } from 'node:path';
import { toolJournal, type ToolJournalContext } from '../../core/runs/tools.js';
import type { LearningService } from '../../core/learning/service.js';
import type { WebSessionStore } from '../sessions/store.js';
import { settleInterruptedEvents } from './terminal.js';
import { saveRunSession } from './persistence.js';
import { notify, publish } from './stream.js';
import type { ChatGenerator, SearchRun } from './types.js';

export async function executeRun(run: SearchRun, generate: ChatGenerator, sessions: WebSessionStore, learning?: LearningService) {
  const context: ToolJournalContext = { pending: new Set(), append: async (entry) => {
    try {
      await run.journal.append(entry);
      run.tools.push(entry);
    } catch (error) {
      run.controller.abort(error);
      throw error;
    }
  } };
  await browserConversation.run(join(sessions.dir, run.record.chatId), () => toolJournal.run(context, async () => {
    let generation: Awaited<ReturnType<ChatGenerator>> | undefined;
    try {
      generation = await generate({ messages: run.record.messages, selection: run.record.selection,
        signal: run.controller.signal, runId: run.record.id });
      await consumeRun(run, generation.stream);
      if (run.record.status === 'running') run.record.status = 'completed';
    } catch (error) {
      if (!run.controller.signal.aborted) run.controller.abort(error);

      run.record.status = run.controller.signal.aborted
        ? run.controller.signal.reason === 'shutdown' ? 'interrupted' : run.controller.signal.reason === 'stop' ? 'stopped' : 'failed'
        : 'failed';
      run.record.error = String(error);
    } finally {
      try {
        await Promise.allSettled([...context.pending]);
        if (run.record.status !== 'completed') await finishInterruptedRun(run);

        run.record.finishedAt = Date.now();
        await run.journal.save(run.record);
        await saveRunSession(sessions, run, learning);
      } finally {
        await generation?.close?.();
        notify(run);
      }
    }
  }));
}

async function consumeRun(run: SearchRun, stream: ReadableStream<import('ai').UIMessageChunk>) {
  const reader = stream.getReader();
  const abort = () => void reader.cancel().catch(() => undefined);
  run.controller.signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      run.controller.signal.throwIfAborted();
      const next = await reader.read();
      run.controller.signal.throwIfAborted();
      if (next.done) {
        if (!run.events.some((event) => ['finish', 'error', 'abort'].includes(event.type))) throw new Error('Provider stream ended before completion.');

        break;
      }

      if (next.value.type === 'error') {
        run.record.status = 'failed';
        run.record.error = next.value.errorText;
      }
      if (next.value.type === 'abort') run.record.status = 'stopped';
      await publish(run, next.value);
    }
  } catch (error) {
    // Stop both provider generation and its stream before releasing run ownership.
    if (!run.controller.signal.aborted) run.controller.abort(error);

    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    run.controller.signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

async function finishInterruptedRun(run: SearchRun): Promise<void> {
  try {
    await settleInterruptedEvents(run);
    await publish(run, run.record.status === 'stopped'
      ? { type: 'abort', reason: 'Stopped by user' }
      : { type: 'error', errorText: `Search interrupted: ${run.record.error ?? run.record.status}` });
  } catch {
    // The prior durable starts remain uncertain if storage itself failed.
  }
}
