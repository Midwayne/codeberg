import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ToolSettingsStore } from './settings.js';

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'codeberg-tools-'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

it('defaults search off without starting resources and preserves direct URL fetching', async () => {
  const store = new ToolSettingsStore({ home, env: {} });

  expect(await store.current()).toMatchObject({ webSearch: false, status: 'disabled' });
  expect(await store.environment()).toMatchObject({ CODEBERG_WEB_SEARCH_USE: 'false', CODEBERG_SEARXNG_URL: '', CODEBERG_BROWSER_USE: 'false' });
});

it('persists the global preference and applies it to subsequent request environments', async () => {
  const env = { CODEBERG_SEARXNG_URL: 'https://search.example.com' };
  const store = new ToolSettingsStore({ home, env });

  expect(await store.update({ webSearch: true })).toMatchObject({ webSearch: true, status: 'ready', provider: 'external' });
  expect(await new ToolSettingsStore({ home, env }).environment()).toMatchObject({
    CODEBERG_WEB_SEARCH_USE: 'true', CODEBERG_SEARXNG_URL: env.CODEBERG_SEARXNG_URL,
  });

  await store.update({ webSearch: false });

  expect(JSON.parse(await readFile(join(home, 'tool-settings.json'), 'utf8'))).toEqual({ webSearch: false, browserUse: false, browserVision: false });
  expect((await store.environment()).CODEBERG_WEB_SEARCH_USE).toBe('false');
});

it('starts and stops the managed worker through its private control endpoint', async () => {
  const control = vi.fn(async (_input: unknown, init?: RequestInit) => {
    const enabled = JSON.parse(String(init?.body)).enabled;

    return Response.json({ status: enabled ? 'ready' : 'disabled', url: enabled ? 'http://127.0.0.1:49152' : '' });
  });
  const store = new ToolSettingsStore({ home, env: {
    CODEBERG_SEARCH_CONTROL_URL: 'http://127.0.0.1:40000', CODEBERG_SEARCH_CONTROL_TOKEN: 'test-token',
  }, fetch: control });

  await store.update({ webSearch: true });
  expect((await store.environment()).CODEBERG_SEARXNG_URL).toBe('http://127.0.0.1:49152');

  await store.update({ webSearch: false });

  expect(JSON.parse(String(control.mock.calls.at(-1)?.[1]?.body))).toEqual({ enabled: false });
  expect(control.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer test-token' });
});

it('keeps the master web-access switch authoritative and validates mutations', async () => {
  const store = new ToolSettingsStore({ home, env: { CODEBERG_WEB_USE: 'false' } });

  expect(await store.current()).toMatchObject({ webSearch: false, allowed: false });
  await expect(store.update({ webSearch: true })).rejects.toThrow('CODEBERG_WEB_USE');
  await expect(store.update({ webSearch: 'false' })).rejects.toThrow('boolean');
});

it('does not advertise search until background setup is ready', async () => {
  const store = new ToolSettingsStore({ home, env: { CODEBERG_SEARCH_CONTROL_URL: 'http://127.0.0.1:40000' },
    fetch: async () => Response.json({ status: 'starting', url: '' }) });

  expect(await store.update({ webSearch: true })).toMatchObject({ webSearch: true, status: 'starting' });
  expect((await store.environment()).CODEBERG_SEARXNG_URL).toBe('');
});

it('keeps code chat available but fails search closed if worker control is unavailable', async () => {
  const store = new ToolSettingsStore({ home, env: { CODEBERG_SEARCH_CONTROL_URL: 'http://127.0.0.1:40000' },
    fetch: async () => { throw new Error('connection refused'); } });

  expect(await store.update({ webSearch: false })).toMatchObject({ webSearch: false, status: 'error', message: 'connection refused' });
  expect((await store.environment()).CODEBERG_WEB_SEARCH_USE).toBe('false');
});

it.each(['{broken', 'null', '[]', '{"webSearch":"true"}'])(
  'fails search closed for corrupt saved settings and recovers when disabled: %s', async (content) => {
    await writeFile(join(home, 'tool-settings.json'), content);
    const store = new ToolSettingsStore({ home, env: { CODEBERG_WEB_SEARCH_USE: 'true' } });

    await expect(store.current()).rejects.toThrow();
    expect((await store.environment()).CODEBERG_WEB_SEARCH_USE).toBe('false');
    expect(await store.update({ webSearch: false })).toMatchObject({ webSearch: false, status: 'disabled' });
  },
);

it.each([null, [], {}, { status: 'unknown' }, { status: 'ready', url: {} },
  { status: 'ready', url: 'https://unexpected.example.com' }, { status: 'error', message: {} }].map((body) => ({ body })))(
  'reports malformed managed-service data without exposing search: $body', async ({ body }) => {
    const store = new ToolSettingsStore({ home, env: {
      CODEBERG_WEB_SEARCH_USE: 'true', CODEBERG_SEARCH_CONTROL_URL: 'http://127.0.0.1:40000',
    }, fetch: async () => Response.json(body) });

    expect(await store.current()).toMatchObject({ webSearch: true, status: 'error' });
    expect((await store.environment()).CODEBERG_WEB_SEARCH_USE).toBe('false');
  },
);

it('does not report a worker stopped if the control endpoint still reports it ready', async () => {
  const store = new ToolSettingsStore({ home, env: { CODEBERG_SEARCH_CONTROL_URL: 'http://127.0.0.1:40000' },
    fetch: async () => Response.json({ status: 'ready', url: 'http://127.0.0.1:49152' }) });

  expect(await store.update({ webSearch: false })).toMatchObject({ webSearch: false, status: 'error',
    message: 'Web search service did not stop. Retry.' });
});

it('serializes conflicting changes and keeps the queue usable after invalid input', async () => {
  const store = new ToolSettingsStore({ home, env: { CODEBERG_SEARXNG_URL: 'https://search.example.com' } });
  const changes = await Promise.allSettled([
    store.update({ webSearch: true }), store.update({ webSearch: null }), store.update({ webSearch: false }),
  ]);

  expect(changes.map((value) => value.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  expect(await store.current()).toMatchObject({ webSearch: false });
  expect(JSON.parse(await readFile(join(home, 'tool-settings.json'), 'utf8'))).toEqual({ webSearch: false, browserUse: false, browserVision: false });
});

it('recovers from a failed disk write without poisoning future changes', async () => {
  const path = join(home, 'tool-settings.json');
  await mkdir(path);
  const store = new ToolSettingsStore({ home, env: {} });

  await expect(store.update({ webSearch: false })).rejects.toThrow();
  expect((await store.environment()).CODEBERG_WEB_SEARCH_USE).toBe('false');

  await rm(path, { recursive: true });

  expect(await store.update({ webSearch: false })).toMatchObject({ webSearch: false });
});

it('persists browser delegation independently without starting a worker or search', async () => {
  const store = new ToolSettingsStore({ home, env: {} });
  expect(await store.current()).toMatchObject({ browserUse: false });

  expect(await store.update({ browserUse: true })).toMatchObject({ browserUse: true, webSearch: false });
  expect(await new ToolSettingsStore({ home, env: {} }).current()).toMatchObject({ browserUse: true });
  expect(await store.environment()).toMatchObject({ CODEBERG_BROWSER_USE: 'true' });

  await store.update({ webSearch: false });
  expect(await store.current()).toMatchObject({ browserUse: true });
  await store.update({ browserUse: false });
  expect((await store.environment()).CODEBERG_BROWSER_USE).toBe('false');
});

it('migrates old settings and validates browser changes against the master switch', async () => {
  await writeFile(join(home, 'tool-settings.json'), JSON.stringify({ webSearch: true }));
  const store = new ToolSettingsStore({ home, env: {} });
  expect(await store.current()).toMatchObject({ browserUse: false, webSearch: true });
  await expect(store.update({ browserUse: 'yes' })).rejects.toThrow('boolean');
  const blocked = new ToolSettingsStore({ home, env: { CODEBERG_WEB_USE: 'false' } });
  await expect(blocked.update({ browserUse: true })).rejects.toThrow('CODEBERG_WEB_USE');
});

it('keeps browser delegation available when the unrelated search worker is unavailable', async () => {
  await writeFile(join(home, 'tool-settings.json'), JSON.stringify({ webSearch: true, browserUse: true }));
  const store = new ToolSettingsStore({ home, env: { CODEBERG_SEARCH_CONTROL_URL: 'http://unavailable' },
    fetch: async () => { throw new Error('search is unavailable'); } });

  expect(await store.environment()).toMatchObject({ CODEBERG_BROWSER_USE: 'true', CODEBERG_WEB_SEARCH_USE: 'false' });
});

it.each([false, true])('allows reading and changing browser preferences when search control fails (search: %s)', async (webSearch) => {
  await writeFile(join(home, 'tool-settings.json'), JSON.stringify({ webSearch, browserUse: false }));
  const store = new ToolSettingsStore({ home, env: { CODEBERG_SEARCH_CONTROL_URL: 'http://unavailable' },
    fetch: async () => { throw new Error('search control unavailable'); } });

  expect(await store.current()).toMatchObject({ browserUse: false, webSearch, status: 'error', message: 'search control unavailable' });
  expect(await store.update({ browserUse: true })).toMatchObject({ browserUse: true, webSearch, status: 'error' });
  expect(await store.environment()).toMatchObject({ CODEBERG_BROWSER_USE: 'true', CODEBERG_WEB_SEARCH_USE: 'false', CODEBERG_SEARXNG_URL: '' });
  expect(await store.update({ browserUse: false })).toMatchObject({ browserUse: false, webSearch });
  expect(JSON.parse(await readFile(join(home, 'tool-settings.json'), 'utf8'))).toEqual({ browserUse: false, browserVision: false, webSearch });
});

it('keeps external search available when stopping the unrelated managed worker fails', async () => {
  const store = new ToolSettingsStore({ home, env: { CODEBERG_SEARXNG_URL: 'https://search.example.com',
    CODEBERG_SEARCH_CONTROL_URL: 'http://unavailable' }, fetch: async () => { throw new Error('control unavailable'); } });

  expect(await store.update({ webSearch: true, browserUse: true })).toMatchObject({
    provider: 'external', status: 'ready', browserUse: true, message: 'control unavailable',
  });
  expect(await store.environment()).toMatchObject({ CODEBERG_WEB_SEARCH_USE: 'true',
    CODEBERG_SEARXNG_URL: 'https://search.example.com', CODEBERG_BROWSER_USE: 'true' });
});

it('returns browser preferences before the UI deadline when search control stalls', async () => {
  const nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
    expect(milliseconds).toBeLessThan(20_000);

    return nativeTimeout(10);
  });
  const store = new ToolSettingsStore({ home, env: { CODEBERG_BROWSER_USE: 'true', CODEBERG_SEARCH_CONTROL_URL: 'http://stalled' },
    fetch: async (_input, init) => new Promise((_resolve, reject) => {
      const signal = init!.signal!;
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }) });

  try {
    expect(await store.current()).toMatchObject({ browserUse: true, status: 'error' });
  } finally {
    timeout.mockRestore();
  }
});
