import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { requestProjectCatalog } from './project-catalog-request';

const catalog = { defaultId: 'example', projects: [{ id: 'example', name: 'Example', roots: [] }] };

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('waits out a project service that is still starting', async () => {
  const api = vi.fn()
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce(new Response('Project service is not reachable.', { status: 502 }))
    .mockResolvedValueOnce(Response.json(catalog));
  vi.stubGlobal('fetch', api);

  const loaded = requestProjectCatalog(new AbortController().signal);
  await vi.advanceTimersByTimeAsync(1500);

  await expect(loaded).resolves.toEqual(catalog);
  expect(api).toHaveBeenCalledTimes(3);
});

it('reports a real failure at once instead of retrying it', async () => {
  const api = vi.fn().mockResolvedValue(new Response('unsupported project catalog version 2', { status: 503 }));
  vi.stubGlobal('fetch', api);

  await expect(requestProjectCatalog(new AbortController().signal)).rejects.toThrow('unsupported project catalog');
  expect(api).toHaveBeenCalledOnce();
});

it('gives up after the startup allowance and stops when the page moves on', async () => {
  const api = vi.fn().mockImplementation(() => Promise.resolve(new Response('unreachable', { status: 502 })));
  vi.stubGlobal('fetch', api);

  const failed = expect(requestProjectCatalog(new AbortController().signal)).rejects.toThrow('unreachable');
  await vi.advanceTimersByTimeAsync(10_500);
  await failed;
  expect(api).toHaveBeenCalledTimes(6);

  const controller = new AbortController();
  const aborted = expect(requestProjectCatalog(controller.signal)).rejects.toThrow('left');
  await vi.advanceTimersByTimeAsync(0);
  controller.abort(new Error('left'));
  await aborted;
  expect(vi.getTimerCount()).toBe(0);
});
