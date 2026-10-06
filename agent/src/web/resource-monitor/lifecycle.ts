import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { writeModuleLog } from '../../core/module-log.js';
import { RESOURCE_WORKER_URL } from '../resource-monitor.js';
import type { ResourceSample } from '../resources.js';
import type { ResourceMonitorClientState } from './state.js';
import { probe, scheduleProbe } from './transport.js';
import { RETENTION_MS, type ResourceWorkerData } from './types.js';

export function start(state: ResourceMonitorClientState): void {
  if (state.started) return;

  state.started = true;
  if (state.endpoint) void probe(state);
  else startWorker(state);
}

export function stop(state: ResourceMonitorClientState): void {
  state.started = false;
  state.controller.abort();
  if (state.retry) clearTimeout(state.retry);

  void state.worker?.terminate();
  state.worker = undefined;
}

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
