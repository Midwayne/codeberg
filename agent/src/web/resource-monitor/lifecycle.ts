import { probe, startWorker } from './collector.js';
import type { ResourceMonitorClientState } from './state.js';

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
