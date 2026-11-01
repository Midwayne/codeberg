import { useEffect, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useProjectStatus } from './use-project-shell';

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: vi.fn(),
  useEffect: vi.fn(),
}));

const project = { id: 'example', name: 'Example', roots: [] };
const progress = { ready: false, indexing: true, chunks: 42 };
let status: unknown;
let cleanup: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  status = undefined;
  vi.mocked(useState).mockImplementation(() => [status, (next: unknown) => {
    status = typeof next === 'function' ? next(status) : next;
  }] as never);
  vi.mocked(useEffect).mockImplementation((effect) => {
    cleanup = effect() || undefined;
  });
});

afterEach(() => {
  cleanup?.();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('accepts a slow status reply beyond the former seven-second deadline', async () => {
  const api = vi.fn((_input: unknown, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    setTimeout(() => resolve(Response.json(progress)), 8000);
  }));
  useProjectStatus({ project, api, retry: 0 });

  await vi.advanceTimersByTimeAsync(8000);

  expect(status).toEqual({ id: project.id, value: progress });
  expect(api).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(1);
});

it('bounds a stalled poll and retries without overlapping requests', async () => {
  let active = 0;
  const api = vi.fn((_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    expect(++active).toBe(1);
    init?.signal?.addEventListener('abort', () => {
      active--;
      reject(init.signal?.reason);
    }, { once: true });
  }));
  useProjectStatus({ project, api, retry: 0 });

  await vi.advanceTimersByTimeAsync(19_999);
  expect(api).toHaveBeenCalledOnce();

  await vi.advanceTimersByTimeAsync(1);
  expect(status).toBeUndefined();
  expect(active).toBe(0);

  await vi.advanceTimersByTimeAsync(22_000);
  expect(api).toHaveBeenCalledTimes(2);
  expect(status).toMatchObject({ error: expect.stringContaining('Retrying automatically') });
  expect(active).toBe(0);
});

it('refreshes the catalog when a project was removed in another tab', async () => {
  const api = vi.fn().mockResolvedValue(new Response('project not found', { status: 404 }));
  const refreshCatalog = vi.fn();
  useProjectStatus({ project, api, retry: 0, refreshCatalog });

  await vi.advanceTimersByTimeAsync(0);

  expect(refreshCatalog).toHaveBeenCalledOnce();
  expect(status).toMatchObject({ error: 'project not found' });
});

it('retains progress through one timeout, reports a repeated outage, and recovers', async () => {
  const api = vi.fn()
    .mockResolvedValueOnce(Response.json(progress))
    .mockRejectedValueOnce(new DOMException('signal timed out', 'TimeoutError'))
    .mockResolvedValueOnce(new Response('Project service did not respond in time.', { status: 504 }))
    .mockResolvedValueOnce(Response.json({ ...progress, ready: true, indexing: false }));
  useProjectStatus({ project, api, retry: 0 });
  await vi.advanceTimersByTimeAsync(0);

  await vi.advanceTimersByTimeAsync(2000);
  expect(status).toEqual({ id: project.id, value: progress });

  await vi.advanceTimersByTimeAsync(2000);
  expect(status).toMatchObject({ id: project.id, value: progress, error: expect.stringMatching(/status.*retry|status.*again/i) });
  expect(JSON.stringify(status)).not.toContain('TimeoutError');

  await vi.advanceTimersByTimeAsync(2000);
  expect(status).toEqual({ id: project.id, value: { ...progress, ready: true, indexing: false } });
});

it('reports actual project failures immediately', async () => {
  const api = vi.fn().mockResolvedValue(new Response('Project directory is unavailable', { status: 503 }));
  useProjectStatus({ project, api, retry: 0 });

  await vi.advanceTimersByTimeAsync(0);

  expect(status).toMatchObject({ error: expect.stringContaining('Project directory is unavailable') });
});

it('cancels an in-flight poll on unmount without publishing an error or polling again', async () => {
  let signal: AbortSignal | undefined;
  const api = vi.fn((_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    signal = init?.signal ?? undefined;
    signal?.addEventListener('abort', () => reject(signal?.reason), { once: true });
  }));
  useProjectStatus({ project, api, retry: 0 });

  cleanup?.();
  await vi.advanceTimersByTimeAsync(60_000);

  expect(signal?.aborted).toBe(true);
  expect(status).toBeUndefined();
  expect(api).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
