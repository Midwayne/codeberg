import { useCallback, useEffect, useRef, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useToolSettings } from './use-tool-settings';

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useState: vi.fn(),
  useRef: vi.fn(),
  useCallback: vi.fn(),
  useEffect: vi.fn(),
}));

const ready = { browserUse: false, browserVision: false, webSearch: true, allowed: true, provider: 'managed', status: 'ready' };
const off = { ...ready, webSearch: false, status: 'disabled' };
let values: unknown[];
let refs: { current: unknown }[];
let cleanups: (() => void)[];

beforeEach(() => {
  values = [];
  refs = [];
  cleanups = [];
  vi.mocked(useCallback).mockImplementation((callback) => callback);
  vi.mocked(useEffect).mockImplementation(() => undefined);
});

afterEach(() => {
  for (const cleanup of cleanups) cleanup();

  vi.unstubAllGlobals();
});

function render() {
  let stateIndex = 0;
  let refIndex = 0;
  vi.mocked(useState).mockImplementation((initial?: unknown) => {
    const index = stateIndex++;
    if (!(index in values)) values[index] = initial;

    return [values[index], (value: unknown) => { values[index] = value; }] as never;
  });
  vi.mocked(useRef).mockImplementation((initial) => {
    const index = refIndex++;
    refs[index] ??= { current: initial };

    return refs[index] as never;
  });

  return useToolSettings();
}

function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });

  return { promise, resolve };
}

it.each([null, [], {}, { ...ready, message: { invalid: true } }, { ...ready, webSearch: 'yes' }].map((body) => ({ body })))(
  'handles an invalid successful response without putting it into render state: $body', async ({ body }) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(body)));
    const hook = render();

    await hook.refresh();

    expect(render().settings).toBeUndefined();
    expect(render().error).toMatch(/invalid|unavailable/i);
  },
);

it('does not let a refresh overwrite an in-flight save', async () => {
  const pending = deferred();
  const fetch = vi.fn(() => pending.promise);
  vi.stubGlobal('fetch', fetch);
  const hook = render();

  const saving = hook.change(true);
  const refreshing = hook.refresh();
  pending.resolve(Response.json(ready));
  await Promise.all([saving, refreshing]);

  expect(fetch).toHaveBeenCalledTimes(1);
  expect(render().settings).toEqual(ready);
  expect(render().busy).toBe(false);
});

it('does not repeatedly supersede a slow polling request', async () => {
  const pending = deferred();
  const fetch = vi.fn(() => pending.promise);
  vi.stubGlobal('fetch', fetch);
  const hook = render();

  const first = hook.refresh();
  const second = hook.refresh();
  pending.resolve(Response.json(ready));
  await Promise.all([first, second]);

  expect(fetch).toHaveBeenCalledTimes(1);
  expect(render().settings).toEqual(ready);
});

it('ignores an old read when a newer mutation has completed', async () => {
  const pending = deferred();
  const fetch = vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValueOnce(Response.json(ready));
  vi.stubGlobal('fetch', fetch);
  const hook = render();

  const reading = hook.refresh();
  await hook.change(true);
  pending.resolve(Response.json(off));
  await reading;

  expect(render().settings).toEqual(ready);
});

it('rejects duplicate saves until the accepted save settles', async () => {
  const pending = deferred();
  const fetch = vi.fn(() => pending.promise);
  vi.stubGlobal('fetch', fetch);
  const hook = render();

  const saving = hook.change(true);
  const duplicate = hook.change(false);
  pending.resolve(Response.json(ready));
  await Promise.all([saving, duplicate]);

  expect(fetch).toHaveBeenCalledTimes(1);
  expect(render().settings).toEqual(ready);
});

it('clears saving state after a network failure and allows a retry', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(Response.json(off));
  vi.stubGlobal('fetch', fetch);
  const hook = render();

  await hook.change(false);
  expect(render().busy).toBe(false);
  expect(render().error).toContain('offline');

  await hook.refresh();
  expect(render().settings).toEqual(off);
  expect(render().error).toBe('');
});

it('cancels pending work on unmount and ignores late responses', async () => {
  vi.mocked(useEffect).mockImplementation((effect) => {
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  });
  const pending = deferred();
  const fetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => pending.promise);
  vi.stubGlobal('fetch', fetch);
  const hook = render();
  const reading = hook.refresh();

  for (const cleanup of cleanups.splice(0)) cleanup();
  pending.resolve(Response.json(ready));
  await reading;

  expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  expect(values[0]).toBeUndefined();
});

it.each([Response.json({ error: { bad: true } }, { status: 503 }), new Response('not json', { status: 503 })])(
  'handles malformed error responses without losing existing settings', async (response) => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(off)).mockResolvedValueOnce(response);
    vi.stubGlobal('fetch', fetch);
    const hook = render();
    await hook.refresh();

    await hook.change(true);

    expect(render().settings).toEqual(off);
    expect(render().error).not.toBe('');
    expect(render().busy).toBe(false);
  },
);

it('times out a stalled save and releases the switch for a retry', async () => {
  const timeout = new AbortController();
  const timer = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
  vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
  })));
  const hook = render();

  try {
    const saving = hook.change(true);
    timeout.abort(new DOMException('Request timed out', 'TimeoutError'));
    await saving;

    expect(render().busy).toBe(false);
    expect(render().error).toContain('timed out');
  } finally {
    timer.mockRestore();
  }
});

it('updates browser delegation without overwriting the web search preference', async () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ ...off, browserUse: true }));
  vi.stubGlobal('fetch', fetch);

  await render().change({ browserUse: true });

  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({ browserUse: true });
  expect(render().settings?.browserUse).toBe(true);
});

it('changes screenshot access without overwriting the other tool preferences', async () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ ...ready, browserVision: true }));
  vi.stubGlobal('fetch', fetch);

  await render().change({ browserVision: true });

  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({ browserVision: true });
  expect(render().settings).toMatchObject({ browserVision: true, browserUse: false, webSearch: true });
});
