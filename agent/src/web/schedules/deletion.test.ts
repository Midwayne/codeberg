import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createWebServer } from '../server.js';
import { SearchRuns } from '../runs/manager.js';
import { WebSessionStore } from '../sessions/store.js';

it('blocks chat deletion during scheduled admission so a stale snapshot cannot recreate it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codeberg-schedule-delete-'));
  const sessions = new WebSessionStore(directory);
  await sessions.upsert({ id: 'chat', title: 'Scheduled', messages: [] });
  const generate = vi.fn(async () => ({ stream: new ReadableStream({ start(controller) {
    controller.enqueue({ type: 'finish', finishReason: 'stop' });
    controller.close();
  } }) }));
  const runs = new SearchRuns(sessions, generate);
  const job = await runs.schedules.create({ chatId: 'chat', sourceRunId: 'origin' }, { prompt: 'Later', delay_seconds: 1 });
  const server = createWebServer({ title: 'test', sessionStore: sessions, runs });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const original = runs.schedules.store.read.bind(runs.schedules.store);
  const read = vi.spyOn(runs.schedules.store, 'read').mockImplementationOnce(async () => {
    await gate;
    return original();
  });
  const tick = runs.schedules.tick(job.dueAt!);
  try {
    await vi.waitFor(() => expect(read).toHaveBeenCalled());
    const deleted = await fetch(`${base}/api/sessions/chat`, { method: 'DELETE' });
    expect(deleted.status).toBe(409);
    expect(await sessions.load('chat')).not.toBeNull();
  } finally {
    release();
    await tick;
    read.mockRestore();
    await runs.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
