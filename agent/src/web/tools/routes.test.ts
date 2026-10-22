import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request, type Server } from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createProjectRequestHandler } from '../projects.js';
import { ToolSettingsStore } from './settings.js';

let server: Server;
let home: string;
let url: string;
let env: NodeJS.ProcessEnv;
const control = vi.fn<typeof fetch>();
const build = vi.fn(async () => { throw new Error('No project or model should be needed.'); });

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'codeberg-tool-http-'));
  env = { CODEBERG_SEARXNG_URL: 'https://search.example.com' };
  control.mockReset();
  server = createServer(createProjectRequestHandler({
    catalog: { version: 1, defaultId: '', legacyId: '', projects: [] },
    home, daemonUrl: 'http://unused', build,
    tools: new ToolSettingsStore({ home, env, fetch: control }),
  }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/settings/tools`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(home, { recursive: true, force: true });
});

it('works without a project or model, with a global preference across project headers', async () => {
  expect(await (await fetch(url)).json()).toMatchObject({ webSearch: false });
  const response = await fetch(url, { method: 'PUT', headers: {
    'Content-Type': 'application/json', 'X-Codeberg-Project': 'one',
  }, body: JSON.stringify({ webSearch: true }) });

  expect(response.status).toBe(200);
  expect(await (await fetch(url, { headers: { 'X-Codeberg-Project': 'two' } })).json()).toMatchObject({ webSearch: true });
  expect(build).not.toHaveBeenCalled();
});

it('rejects cross-origin, non-JSON, malformed and non-boolean changes', async () => {
  expect((await fetch(url, { method: 'PUT', headers: { Origin: 'https://elsewhere.example',
    'Content-Type': 'application/json' }, body: '{"webSearch":true}' })).status).toBe(403);
  expect((await fetch(url, { method: 'PUT', body: '{"webSearch":true}' })).status).toBe(415);
  for (const body of ['{broken', '{"webSearch":"false"}', 'null', '[]', 'false', '0', '"settings"', '{"webSearch":{}}']) {
    expect((await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })).status).toBe(400);
  }
  expect((await fetch(url, { method: 'POST' })).status).toBe(405);
});

it('rejects an oversized payload and serves later valid requests normally', async () => {
  const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ webSearch: true, padding: 'x'.repeat(8192) }) });

  expect(response.status).toBe(413);
  expect(await (await fetch(url)).json()).toMatchObject({ webSearch: false });
});

it('handles a corrupt settings file without taking down the server and allows repair', async () => {
  await writeFile(join(home, 'tool-settings.json'), '{truncated');

  expect((await fetch(url)).status).toBe(503);
  const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ webSearch: false }) });

  expect(response.status).toBe(200);
  expect(await (await fetch(url)).json()).toMatchObject({ webSearch: false });
});

it('handles an interrupted request body and continues serving settings', async () => {
  const received = new Promise<void>((resolve) => server.once('request', () => resolve()));
  const interrupted = request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' } });
  const closed = new Promise<void>((resolve) => {
    interrupted.once('error', () => undefined);
    interrupted.once('close', resolve);
  });
  interrupted.write('{"webSearch":');
  await received;
  interrupted.destroy();
  await closed;

  expect((await fetch(url)).status).toBe(200);
});

it('toggles browser delegation independently before project or model setup', async () => {
  const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ browserUse: true }) });

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ browserUse: true, webSearch: false });
  expect(await (await fetch(url)).json()).toMatchObject({ browserUse: true, webSearch: false });
  expect(build).not.toHaveBeenCalled();
});

it('serves both switches and saves browser changes while search control is unavailable', async () => {
  delete env.CODEBERG_SEARXNG_URL;
  env.CODEBERG_SEARCH_CONTROL_URL = 'http://unavailable';
  control.mockRejectedValue(new Error('search control unavailable'));

  const initial = await fetch(url);
  expect(initial.status).toBe(200);
  expect(await initial.json()).toMatchObject({ webSearch: false, browserUse: false, status: 'error' });

  for (const browserUse of [true, false]) {
    const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browserUse }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ browserUse, status: 'error' });
    expect(await (await fetch(url)).json()).toMatchObject({ browserUse });
  }

  expect(build).not.toHaveBeenCalled();
});

it('persists vision independently and validates it before a model or project is configured', async () => {
  expect(await (await fetch(url)).json()).toMatchObject({ browserUse: false, browserVision: false });
  const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ browserVision: true }) });

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ browserVision: true, browserUse: false, webSearch: false });
  const invalid = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ browserVision: 'yes' }) });

  expect(invalid.status).toBe(400);
  expect(await (await fetch(url)).json()).toMatchObject({ browserVision: true });
  expect(build).not.toHaveBeenCalled();
});
