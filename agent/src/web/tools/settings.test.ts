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
  expect(await store.environment()).toEqual({ CODEBERG_WEB_SEARCH_USE: 'false', CODEBERG_SEARXNG_URL: '' });
});

it('persists the global preference and applies it to subsequent request environments', async () => {
  const env = { CODEBERG_SEARXNG_URL: 'https://search.example.com' };
  const store = new ToolSettingsStore({ home, env });

  expect(await store.update({ webSearch: true })).toMatchObject({ webSearch: true, status: 'ready', provider: 'external' });
  expect(await new ToolSettingsStore({ home, env }).environment()).toEqual({
    CODEBERG_WEB_SEARCH_USE: 'true', CODEBERG_SEARXNG_URL: env.CODEBERG_SEARXNG_URL,
  });

  await store.update({ webSearch: false });

  expect(JSON.parse(await readFile(join(home, 'tool-settings.json'), 'utf8'))).toEqual({ webSearch: false });
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

  await expect(store.update({ webSearch: false })).rejects.toThrow('connection refused');
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
  'rejects malformed managed-service data without exposing search: $body', async ({ body }) => {
    const store = new ToolSettingsStore({ home, env: {
      CODEBERG_WEB_SEARCH_USE: 'true', CODEBERG_SEARCH_CONTROL_URL: 'http://127.0.0.1:40000',
    }, fetch: async () => Response.json(body) });

    await expect(store.current()).rejects.toThrow();
    expect((await store.environment()).CODEBERG_WEB_SEARCH_USE).toBe('false');
  },
);

it('does not report a worker stopped if the control endpoint still reports it ready', async () => {
  const store = new ToolSettingsStore({ home, env: { CODEBERG_SEARCH_CONTROL_URL: 'http://127.0.0.1:40000' },
    fetch: async () => Response.json({ status: 'ready', url: 'http://127.0.0.1:49152' }) });

  await expect(store.update({ webSearch: false })).rejects.toThrow();
});

it('serializes conflicting changes and keeps the queue usable after invalid input', async () => {
  const store = new ToolSettingsStore({ home, env: { CODEBERG_SEARXNG_URL: 'https://search.example.com' } });
  const changes = await Promise.allSettled([
    store.update({ webSearch: true }), store.update({ webSearch: null }), store.update({ webSearch: false }),
  ]);

  expect(changes.map((value) => value.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  expect(await store.current()).toMatchObject({ webSearch: false });
  expect(JSON.parse(await readFile(join(home, 'tool-settings.json'), 'utf8'))).toEqual({ webSearch: false });
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
