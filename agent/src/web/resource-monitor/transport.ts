import { probe, request, scheduleProbe, startWorker } from './collector.js';
import { start } from './lifecycle.js';
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
