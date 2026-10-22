import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UIMessageChunk } from 'ai';
import { expect, it, vi } from 'vitest';
import { WebSessionStore } from '../sessions/store.js';
import { RunJournal } from './journal.js';
import { SearchRuns } from './manager.js';

it('aborts the provider and cancels its stream before settling a failed journal publication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codeberg-journal-failure-'));
  const original = RunJournal.prototype.append;
  const append = vi.spyOn(RunJournal.prototype, 'append').mockImplementation(async function (this: RunJournal, entry) {
    if (entry.kind === 'chunk' && entry.chunk.type === 'text-delta') throw new Error('disk full');

    return original.call(this, entry);
  });
  let providerSignal: AbortSignal | undefined;
  const cancel = vi.fn();
  const release = vi.fn(async () => {});
  const runs = new SearchRuns(new WebSessionStore(directory), async ({ signal }) => {
    providerSignal = signal;
    return { close: release, stream: new ReadableStream<UIMessageChunk>({ start(controller) {
      controller.enqueue({ type: 'start' });
      controller.enqueue({ type: 'text-start', id: 'text' });
      controller.enqueue({ type: 'text-delta', id: 'text', delta: 'unsaved' });
      // The provider remains live until execution explicitly cancels it.
    }, cancel }) };
  });

  try {
    const run = await runs.admit({ chatId: 'chat', requestId: 'request',
      messages: [{ id: 'user', role: 'user', parts: [{ type: 'text', text: 'Find auth' }] }] });
    await run.done;

    expect(run.record.status).toBe('failed');
    expect(providerSignal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(runs.busy).toBe(false);
    expect(run.events.some((event) => event.type === 'text-delta')).toBe(false);
  } finally {
    append.mockRestore();
    await runs.close();
    await rm(directory, { recursive: true, force: true });
  }
});
