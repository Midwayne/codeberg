import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { pollScene } from './scene-poll';

const scene = (revision: number) => ({ name: 'chat-one', revision, elements: [], appState: {}, files: {} });

function handlers() {
  return { scene: vi.fn(), status: vi.fn() };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it('applies the first scene, then sends its tag and ignores unchanged polls', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json(scene(1), { headers: { ETag: '"chat-one:1"' } }))
    .mockResolvedValueOnce(new Response(null, { status: 304 }))
    .mockResolvedValueOnce(Response.json(scene(2), { headers: { ETag: '"chat-one:2"' } }));
  const on = handlers();

  const poll = pollScene(fetcher, on, 1000);
  await vi.advanceTimersByTimeAsync(0);

  expect(on.scene).toHaveBeenCalledExactlyOnceWith(scene(1));
  expect(fetcher.mock.calls[0]![1].headers).toEqual({});

  await vi.advanceTimersByTimeAsync(1000);

  expect(fetcher.mock.calls[1]![1].headers).toEqual({ 'If-None-Match': '"chat-one:1"' });
  expect(on.scene).toHaveBeenCalledOnce();

  await vi.advanceTimersByTimeAsync(1000);

  expect(on.scene).toHaveBeenLastCalledWith(scene(2));
  poll.close();
});

it('reports a missing drawing, server errors and disconnects, and keeps polling', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ error: 'Canvas not found.' }, { status: 404 }))
    .mockResolvedValueOnce(Response.json({ error: 'Canvas is disabled.' }, { status: 403 }))
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce(Response.json(scene(1), { headers: { ETag: '"chat-one:1"' } }));
  const on = handlers();

  const poll = pollScene(fetcher, on, 1000);
  await vi.advanceTimersByTimeAsync(0);
  expect(on.status).toHaveBeenLastCalledWith('Waiting for the agent’s drawing…');

  await vi.advanceTimersByTimeAsync(1000);
  expect(on.status).toHaveBeenLastCalledWith('Canvas is disabled.');

  await vi.advanceTimersByTimeAsync(1000);
  expect(on.status).toHaveBeenLastCalledWith(expect.stringContaining('Reconnecting'));

  await vi.advanceTimersByTimeAsync(1000);
  expect(on.scene).toHaveBeenCalledExactlyOnceWith(scene(1));
  poll.close();
});

it('stops polling and cancels its request when closed', async () => {
  let signal: AbortSignal | undefined;
  const fetcher = vi.fn((_input: unknown, init?: RequestInit) => {
    signal = init?.signal ?? undefined;

    return new Promise<Response>(() => undefined);
  });
  const on = handlers();

  const poll = pollScene(fetcher as unknown as typeof fetch, on, 1000);
  await vi.advanceTimersByTimeAsync(0);
  poll.close();

  expect(signal?.aborted).toBe(true);

  await vi.advanceTimersByTimeAsync(5000);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
