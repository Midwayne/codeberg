import { start, startWorker } from './lifecycle.js';
import type { ResourceMonitorClientState } from './state.js';
import { DISK_MS, RETENTION_MS, SAMPLE_MS } from './types.js';

export async function read(state: ResourceMonitorClientState, after = 0): Promise<string> {
  if (!state.started) start(state);

  if (state.daemonReady) {
    try {
      const url = new URL('/resources', state.endpoint);
      if (after) url.searchParams.set('after', String(after));

      const response = await request(state, url);
      if (!response.ok) throw new Error(`resource daemon returned ${response.status}`);

      if (response.headers.get('X-Codeberg-Pid') !== state.peerPid) void probe(state);

      return await response.text(); // Relay bytes without parsing/re-encoding history.
    } catch {
      state.daemonReady = false;
      if (state.started) {
        startWorker(state);
        scheduleProbe(state);
      }
    }
  }

  const current = state.history.at(-1) ?? null;
  if (current && after > current.timestamp) after = 0;

  return JSON.stringify({
    current,
    history: state.history
      .filter((row) => row.timestamp > after)
      .map((row) => ({ ...row, processes: [] })),
    retentionMs: RETENTION_MS,
    sampleIntervalMs: SAMPLE_MS,
    diskIntervalMs: DISK_MS,
    collector: 'worker',
    collectorId: state.workerId,
  });
}

export function invalidateDisk(state: ResourceMonitorClientState): void {
  if (state.daemonReady) {
    void request(state, new URL('/resources/refresh', state.endpoint), { method: 'POST' }).catch(
      () => undefined,
    );
  } else state.worker?.postMessage({ kind: 'refreshDisk' });
}

export function request(
  state: ResourceMonitorClientState,
  url: URL,
  init: RequestInit = {},
): Promise<Response> {
  return (state.options.fetch ?? globalThis.fetch)(url, {
    ...init,
    signal: AbortSignal.any([state.controller.signal, AbortSignal.timeout(1000)]),
  });
}

export function probe(state: ResourceMonitorClientState): Promise<void> {
  if (!state.endpoint || !state.started) return Promise.resolve();

  state.probing ??= (async () => {
    try {
      const response = await request(state, new URL('/resources/clients', state.endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid: process.pid }),
      });

      if (!response.ok) throw new Error('daemon collector unavailable');

      await response.arrayBuffer();
      if (!state.started) return;

      state.peerPid = response.headers.get('X-Codeberg-Pid') ?? undefined;
      state.daemonReady = true;
      if (state.retry) clearTimeout(state.retry);

      state.retry = undefined;
      void state.worker?.terminate();
      state.worker = undefined;
      state.history = [];
    } catch {
      if (state.started) {
        startWorker(state);
        scheduleProbe(state);
      }
    }
  })().finally(() => {
    state.probing = undefined;
  });

  return state.probing;
}

export function scheduleProbe(state: ResourceMonitorClientState): void {
  if (state.retry || !state.endpoint || !state.started) return;

  state.retry = setTimeout(() => {
    state.retry = undefined;
    void probe(state);
  }, 30_000);
  state.retry.unref();
}
