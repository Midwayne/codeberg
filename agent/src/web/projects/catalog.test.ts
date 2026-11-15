import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { handle } from './routing.js';
import { ProjectRequestRouterState } from './state.js';

const project = { id: 'p-0123456789abcdef', name: 'Example', roots: [{ key: 'example', root: '/example' }] };

const catalog = { version: 1 as const, projects: [project], defaultId: project.id, legacyId: project.id };

function router() {
  return new ProjectRequestRouterState({
    catalog,
    home: '/home',
    daemonUrl: 'http://daemon.test',
    build: async () => () => undefined,
  });
}

function exchange(method = 'GET') {
  const request = { url: '/api/projects', method, headers: {} } as IncomingMessage;
  const response = { headersSent: false, setHeader: vi.fn(), writeHead: vi.fn(), end: vi.fn() };

  return { request, response };
}

function stalledFetch() {
  return vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('serves the last known projects promptly while the project service is busy', async () => {
  vi.stubGlobal('fetch', stalledFetch());
  const { request, response } = exchange();

  handle(router(), request, response as unknown as ServerResponse);
  await vi.advanceTimersByTimeAsync(1500);

  expect(response.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
  expect(JSON.parse(response.end.mock.calls[0]![0] as string)).toMatchObject({
    defaultId: project.id,
    projects: [{ id: project.id, name: 'Example' }],
  });
  expect(vi.getTimerCount()).toBe(0);
});

it('serves the last known projects while the project service restarts', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
  const { request, response } = exchange();

  handle(router(), request, response as unknown as ServerResponse);
  await vi.advanceTimersByTimeAsync(0);

  expect(response.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
});

it('prefers the project service catalog when it answers in time', async () => {
  const renamed = { ...catalog, projects: [{ ...project, name: 'Renamed' }] };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(renamed)));
  const state = router();
  const { request, response } = exchange();

  handle(state, request, response as unknown as ServerResponse);
  await vi.advanceTimersByTimeAsync(0);

  expect(JSON.parse(response.end.mock.calls[0]![0] as string).projects[0].name).toBe('Renamed');
  expect(state.catalog.projects[0]!.name).toBe('Renamed');
});

it('still reports a project service failure instead of hiding it behind stale projects', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ message: 'catalog is corrupt' }, { status: 500 })));
  const { request, response } = exchange();

  handle(router(), request, response as unknown as ServerResponse);
  await vi.advanceTimersByTimeAsync(0);

  expect(response.writeHead).toHaveBeenCalledWith(503, expect.any(Object));
  expect(response.end).toHaveBeenCalledWith('catalog is corrupt');
});
