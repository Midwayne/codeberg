import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { writeModuleLog } from '../../core/module-log.js';
import type { ResourceSample } from '../resources/types.js';
import { RESOURCE_WORKER_URL } from '../resource-worker-url.js';
import type { ResourceMonitorClientState } from './state.js';
import { RETENTION_MS, type ResourceWorkerData } from './types.js';

// The daemon collector and the local worker fall back to each other, so both live here.

export function startWorker(state: ResourceMonitorClientState): void {
  if (state.worker || !state.started) return;

  state.workerId = randomUUID();
  state.history = [];
  const data: ResourceWorkerData = {
    home: state.options.home,
    sessionsDir: state.options.sessionsDir,
    learningRoot: state.options.learningRoot,
    env: state.options.env,
    daemonUrl: state.options.daemonUrl,
  };

  state.worker =
    state.options.createWorker?.(data) ?? new Worker(RESOURCE_WORKER_URL, { workerData: data });
  state.worker.unref();
  state.worker.on('message', (message: { kind: string; sample?: ResourceSample }) => {
    if (!state.started || !message.sample || message.kind !== 'sample') return;

    const sample = message.sample;
    const previous = state.history.at(-1);
    if (previous && previous.timestamp !== sample.timestamp)
      state.history[state.history.length - 1] = { ...previous, processes: [] };

    state.history = [
      ...state.history.filter(
        (row) =>
          row.timestamp > sample.timestamp - RETENTION_MS && row.timestamp !== sample.timestamp,
      ),
      sample,
    ].slice(-360);
  });
  state.worker.on('error', (error) => {
    writeModuleLog('agent', 'resource_monitor_failed', { error: String(error) });
  });
  const worker = state.worker;
  worker.on('exit', () => {
    if (!state.started || state.worker !== worker) return;

    state.worker = undefined;
    if (state.endpoint) scheduleProbe(state);
    else if (!state.retry) {
      state.retry = setTimeout(() => {
        state.retry = undefined;
        startWorker(state);
      }, 30_000);
      state.retry.unref();
    }
  });
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
