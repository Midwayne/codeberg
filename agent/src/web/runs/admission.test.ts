import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { WebSessionStore } from '../sessions/store.js';
import { RunJournal } from './journal.js';
import { SearchRuns } from './manager.js';
import type { ChatGenerator, RunInput } from './types.js';

it.each(['same process', 'restart', 'partial journal creation'])('retries admission after a failed save: %s', async (scenario) => {
  const directory = await mkdtemp(join(tmpdir(), 'codeberg-admission-'));
  const sessions = new WebSessionStore(directory);
  const generate = vi.fn<ChatGenerator>(async () => ({ stream: new ReadableStream({ start(controller) {
    controller.enqueue({ type: 'start', messageId: 'answer' });
    controller.enqueue({ type: 'finish' });
    controller.close();
  } }) }));
  const runs = new SearchRuns(sessions, generate);
  const input: RunInput = { chatId: 'chat', requestId: 'request',
    messages: [{ id: 'question', role: 'user', parts: [{ type: 'text', text: 'Find auth' }] }] };
  const original = RunJournal.prototype.create;
  const failure = scenario === 'partial journal creation'
    ? vi.spyOn(RunJournal.prototype, 'create').mockImplementationOnce(async function (this: RunJournal, record) {
      await original.call(this, record);
      throw new Error('disk unavailable');
    })
    : vi.spyOn(sessions, 'upsert').mockRejectedValueOnce(new Error('disk unavailable'));
  let restarted: SearchRuns | undefined;

  try {
    await expect(runs.admit(input)).rejects.toThrow('disk unavailable');
    expect(runs.busy).toBe(false);
    expect(generate).not.toHaveBeenCalled();
    expect(await readdir(join(directory, '.runs', 'chat'))).toEqual([]);
    if (scenario === 'restart') restarted = new SearchRuns(sessions, generate);

    const run = await (restarted ?? runs).admit(input);
    await run.done;

    expect(generate).toHaveBeenCalledOnce();
    expect(run.record.status).toBe('completed');
    expect((await sessions.load('chat'))?.serverRunId).toBe(run.record.id);
  } finally {
    failure.mockRestore();
    await runs.close();
    await restarted?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
