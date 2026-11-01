import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { SearchRuns } from './manager.js';
import { WebSessionStore } from '../sessions/store.js';

it('remembers Stop arriving before admission and never executes that request later', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codeberg-stop-admission-'));
  const generate = vi.fn(async () => ({ stream: new ReadableStream({ start(controller) {
    controller.enqueue({ type: 'finish' as const });
    controller.close();
  } }) }));
  const runs = new SearchRuns(new WebSessionStore(directory), generate);

  try {
    await runs.stop('chat', 'request', true);

    await expect(runs.admit({ chatId: 'chat', requestId: 'request',
      messages: [{ id: 'user', role: 'user', parts: [{ type: 'text', text: 'Find auth' }] }],
    })).rejects.toMatchObject({ status: 409 });
    expect(generate).not.toHaveBeenCalled();
    expect(runs.busy).toBe(false);

    const next = await runs.admit({ chatId: 'chat', requestId: 'new-request',
      messages: [{ id: 'next-user', role: 'user', parts: [{ type: 'text', text: 'Try another route' }] }],
    });
    await next.done;
    expect(generate).toHaveBeenCalledOnce();
  } finally {
    await runs.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('confirms Stop when cancellation rejects an admission already validating history', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codeberg-stop-validating-'));
  const sessions = new WebSessionStore(directory);
  const generate = vi.fn();
  const runs = new SearchRuns(sessions, generate);
  await runs.initialize();
  let release!: () => void;
  const validation = new Promise<null>((resolve) => { release = () => resolve(null); });
  const load = vi.spyOn(sessions, 'load').mockImplementationOnce(async () => validation);
  const admission = runs.admit({ chatId: 'chat', requestId: 'request',
    messages: [{ id: 'user', role: 'user', parts: [{ type: 'text', text: 'Find auth' }] }],
  }).catch((error: unknown) => error);

  try {
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    const stopping = runs.stop('chat', 'request', true);
    release();

    await stopping;
    expect(await admission).toMatchObject({ status: 409 });
    expect(generate).not.toHaveBeenCalled();
    expect(runs.busy).toBe(false);
  } finally {
    release();
    await admission;
    load.mockRestore();
    await runs.close();
    await rm(directory, { recursive: true, force: true });
  }
});
