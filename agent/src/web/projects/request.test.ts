import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { daemon } from './routing.js';
import type { ProjectRequestRouterState } from './state.js';
import { requestProjectService } from './request.js';
import { handle } from './routing.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

const state = { options: { daemonUrl: 'http://daemon.test' } } as ProjectRequestRouterState;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('signal timed out', 'TimeoutError')), ms);

    return controller.signal;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('allows a busy project service to respond after the former five-second limit', async () => {
  vi.stubGlobal('fetch', vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    setTimeout(() => resolve(Response.json({ ready: true, chunks: 42 })), 6000);
  })));
  const response = daemon(state, '/projects/example/health');
  const checked = expect(response).resolves.toEqual({ ready: true, chunks: 42 });
  void checked.catch(() => undefined);

  await vi.advanceTimersByTimeAsync(6000);
  await checked;
});

it('bounds a stalled operation, explains the uncertainty, and never repeats the write', async () => {
  const fetch = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
  }));
  vi.stubGlobal('fetch', fetch);
  const response = daemon(state, '/projects', { method: 'POST', body: '{}' });
  const checked = expect(response).rejects.toMatchObject({
    status: 504,
    message: expect.stringMatching(/refresh.*before.*retry/i),
  });
  void checked.catch(() => undefined);

  await vi.advanceTimersByTimeAsync(15_000);
  await checked;
  expect(fetch).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('releases its deadline when a request succeeds', async () => {
  let signal: AbortSignal | undefined;
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    signal = init?.signal ?? undefined;

    return Response.json({ ready: true });
  }));

  await daemon(state, '/projects/example/health');
  expect(vi.getTimerCount()).toBe(0);

  await vi.advanceTimersByTimeAsync(60_000);
  expect(signal?.aborted).toBe(false);
});

it('bounds reading the response body as well as waiting for headers', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => new Response(new ReadableStream({
    start(controller) {
      init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason), { once: true });
    },
  }))));
  const result = daemon(state, '/projects');
  const checked = expect(result).rejects.toMatchObject({ status: 504, message: expect.stringContaining('busy indexing') });

  await vi.advanceTimersByTimeAsync(15_000);
  await checked;
  expect(vi.getTimerCount()).toBe(0);
});

it('honors caller cancellation and clears the deadline', async () => {
  const controller = new AbortController();
  vi.stubGlobal('fetch', vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
  })));
  const result = requestProjectService('http://daemon.test', '/projects', { signal: controller.signal });
  const checked = expect(result).rejects.toThrow('Project changed');

  controller.abort(new Error('Project changed'));
  await checked;
  expect(vi.getTimerCount()).toBe(0);
});

it('exposes a proxy timeout as HTTP 504 so status polling can recover automatically', async () => {
  vi.stubGlobal('fetch', vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
  })));
  const project = { id: 'example', name: 'Example', roots: [] };
  const catalog = { version: 1 as const, projects: [project], defaultId: project.id, legacyId: project.id };
  const router = { ...state, catalog, deleting: new Set<string>() } satisfies ProjectRequestRouterState;
  const request = { url: '/api/project/status', method: 'GET', headers: {} } as IncomingMessage;
  const response = { headersSent: false, setHeader: vi.fn(), writeHead: vi.fn(), end: vi.fn() };

  handle(router, request, response as unknown as ServerResponse);
  await vi.advanceTimersByTimeAsync(15_000);

  expect(response.writeHead).toHaveBeenCalledWith(504, expect.any(Object));
  expect(response.end).toHaveBeenCalledWith(expect.stringContaining('busy indexing'));
});
