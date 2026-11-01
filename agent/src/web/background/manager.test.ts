import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { BackgroundJobs } from './manager.js';

const directories: string[] = [];
const managers: BackgroundJobs[] = [];
const owner = { chatId: 'chat', sourceRunId: 'turn' };
const input = { callId: 'call', tool: 'mcp_kafka_scan_messages', args: { topic: 'events' } };

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'codeberg-background-'));
  directories.push(directory);
  const jobs = new BackgroundJobs(directory);
  managers.push(jobs);

  return { jobs, directory };
}

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((done) => { resolve = done; });

  return { promise, resolve };
}

afterEach(async () => {
  await Promise.all(managers.splice(0).map((jobs) => jobs.close()));
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it('returns a durable handle without waiting, then saves the result exactly once', async () => {
  const { jobs } = await fixture();
  const pending = deferred();
  const execute = vi.fn(() => pending.promise);
  const release = vi.fn(async () => undefined);
  const retain = vi.fn(() => release);
  const job = await jobs.start(owner, input, execute, retain);
  expect(job.status).toBe('running');
  expect(jobs.hasActive('chat')).toBe(true);
  expect((await jobs.get('chat', job.id)).status).toBe('running');
  expect(await jobs.get('chat', job.id)).not.toHaveProperty('jobs');
  expect(release).not.toHaveBeenCalled();

  const duplicate = await jobs.start(owner, input, execute, retain);
  expect(duplicate.id).toBe(job.id);
  expect(execute).toHaveBeenCalledOnce();
  expect(retain).toHaveBeenCalledOnce();
  pending.resolve({ matched: 42 });
  await vi.waitFor(async () => expect((await jobs.get('chat', job.id)).status).toBe('completed'));
  expect((await jobs.get('chat', job.id)).output).toEqual({ matched: 42 });

  // The result is saved before the slot is released in `finally`.
  await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
});

it('isolates chats, rejects changed duplicate arguments, and forwards cancellation', async () => {
  const { jobs } = await fixture();
  let signal!: AbortSignal;
  const pending = deferred();
  const job = await jobs.start(owner, input, (value) => { signal = value; return pending.promise; });
  await expect(jobs.get('other', job.id)).rejects.toThrow('not found');
  await expect(jobs.cancel('other', job.id)).rejects.toThrow('not found');
  await expect(jobs.start(owner, { ...input, args: { topic: 'different' } }, async () => null)).rejects.toThrow('different');
  expect((await jobs.cancel('chat', job.id)).status).toBe('cancelling');
  expect(signal.aborted).toBe(true);
  pending.resolve({ partial: true });
  await vi.waitFor(async () => expect((await jobs.get('chat', job.id)).status).toBe('cancelled'));
});

it('recovers completed results and uncertain in-flight calls without replaying them', async () => {
  const f = await fixture();
  const pending = deferred();
  const running = await f.jobs.start(owner, input, () => pending.promise);
  const completed = await f.jobs.start(owner, { ...input, callId: 'other' }, async () => ({ done: true }));
  await vi.waitFor(async () => expect((await f.jobs.get('chat', completed.id)).status).toBe('completed'));
  await f.jobs.close();

  const restarted = new BackgroundJobs(f.directory);
  managers.push(restarted);
  expect(await restarted.get('chat', completed.id)).toMatchObject({ status: 'completed', output: { done: true } });
  expect(await restarted.get('chat', running.id)).toMatchObject({ status: 'interrupted', error: expect.stringContaining('uncertain') });
  const execute = vi.fn(async () => 'must not repeat');
  await restarted.start(owner, input, execute);
  expect(execute).not.toHaveBeenCalled();
  pending.resolve('late result from old process');
});

it('does not invoke a tool when durable admission fails', async () => {
  const { jobs } = await fixture();
  const execute = vi.fn(async () => 'unexpected');
  const release = vi.fn(async () => undefined);
  vi.spyOn(jobs.store, 'write').mockRejectedValueOnce(new Error('disk full'));
  await expect(jobs.start(owner, input, execute, () => release)).rejects.toThrow('disk full');
  expect(execute).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
});

it('saves yielded progress and a terminal error, without exposing execution context internals', async () => {
  const { jobs } = await fixture();
  const pending = deferred();
  const scope = { ...owner, jobs, sleeping: false };
  const job = await jobs.start(scope, input, async function* () {
    yield { scanned: 100 };
    await pending.promise;
    throw new Error('broker disconnected');
  });
  await vi.waitFor(async () => expect((await jobs.get('chat', job.id)).progress).toEqual({ scanned: 100 }));
  expect(await jobs.get('chat', job.id)).not.toHaveProperty('jobs');
  pending.resolve(null);
  await vi.waitFor(async () => expect((await jobs.get('chat', job.id)).status).toBe('failed'));
  expect((await jobs.get('chat', job.id)).error).toContain('broker disconnected');
});

it('separates job identity across chats even with the same source and call IDs', async () => {
  const { jobs } = await fixture();
  const pending = deferred();
  const first = await jobs.start(owner, input, () => pending.promise);
  const second = await jobs.start({ ...owner, chatId: 'other' }, input, () => pending.promise);

  expect(first.id).not.toBe(second.id);
  expect(jobs.hasActive('chat')).toBe(true);
  expect(jobs.hasActive('other')).toBe(true);
  pending.resolve('done');
});

it.each(['completed', 'failed', 'cancelled'] as const)(
  'preserves a %s job when cancellation arrives during lease cleanup',
  async (status) => {
    const { jobs } = await fixture();
    const cleanup = deferred();
    const work = deferred();
    const release = vi.fn(async () => { await cleanup.promise; });
    let signal!: AbortSignal;
    const job = await jobs.start(owner, input, async (value) => {
      signal = value;
      if (status === 'cancelled') await work.promise;
      if (status === 'failed') throw new Error('broker disconnected');

      return { matched: 42 };
    }, () => release);

    try {
      if (status === 'cancelled') {
        await jobs.cancel('chat', job.id);
        work.resolve(null);
      }
      await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
      const finished = await jobs.get('chat', job.id);
      const aborted = signal.aborted;
      expect(finished.status).toBe(status);
      expect(jobs.hasActive('chat')).toBe(true);

      expect(await jobs.cancel('chat', job.id)).toEqual(finished);
      expect(signal.aborted).toBe(aborted);
      expect(await jobs.get('chat', job.id)).toEqual(finished);
    } finally {
      work.resolve(null);
      cleanup.resolve(null);
    }

    await vi.waitFor(() => expect(jobs.hasActive('chat')).toBe(false));
    expect((await jobs.get('chat', job.id)).status).toBe(status);
  },
);
