import { processLabel } from './labels.js';
import type { ProcessMonitorState } from './state.js';
import type { ProcessSnapshot, ProcessUsage } from './types.js';

export function processUsage(
  state: ProcessMonitorState,
  selected: ProcessSnapshot[],
  options: {
    pid: number;
    cores: number;
    totalBytes: number;
    now: number;
    scope: ProcessUsage['scope'];
  },
): ProcessUsage {
  const { pid, cores, totalBytes, now, scope } = options;

  const elapsed = state.previousAt === undefined ? undefined : now - state.previousAt;
  const current = new Map(selected.map((item) => [`${item.pid}:${item.startedAt}`, item.cpuMs]));
  const processes = selected.map((item) => processMeasurement(state, item, pid, elapsed));

  const complete = processes.every((item) => item.cpuPercent !== null);
  const corePercent = complete
    ? processes.reduce((sum, item) => sum + (item.cpuPercent ?? 0), 0)
    : null;
  state.previous = current;
  state.previousAt = now;
  state.fallbackAt = undefined;
  state.fallbackCpu = undefined;

  return {
    cpu: { usedPercent: corePercent === null ? null : corePercent / cores, corePercent, cores },
    memory: { usedBytes: processes.reduce((sum, item) => sum + item.memoryBytes, 0), totalBytes },
    processes,
    scope,
  };
}

export function processMeasurement(
  state: ProcessMonitorState,
  item: ProcessSnapshot,
  pid: number,
  elapsed: number | undefined,
) {
  const key = `${item.pid}:${item.startedAt}`;
  const previous = state.previous.get(key);
  // A newly spawned child contributes CPU since birth. A newly discovered,
  // already-running process needs a baseline before attributing its CPU.
  const baseline =
    previous ??
    (state.previousAt !== undefined && item.startedAt >= state.previousAt ? 0 : undefined);
  const cpuPercent =
    elapsed && elapsed > 0 && baseline !== undefined
      ? (Math.max(0, item.cpuMs - baseline) / elapsed) * 100
      : null;

  return {
    pid: item.pid,
    name:
      item.pid === pid
        ? 'Web server & learning'
        : (state.names.get(`${item.pid}:${item.startedAt}:${item.command}`) ??
          processLabel(item.command)),
    cpuPercent,
    memoryBytes: item.rssBytes,
  };
}

export function sampleWebProcess(
  state: ProcessMonitorState,
  cores: number,
  totalBytes: number,
): ProcessUsage {
  // Unsupported platforms or an unavailable ps still get truthful web-only
  // measurements. Never substitute whole-host usage for missing process data.
  const now = (state.options.now ?? Date.now)();
  const usage = process.cpuUsage();
  const elapsed = state.fallbackAt === undefined ? undefined : now - state.fallbackAt;
  const corePercent =
    elapsed && elapsed > 0 && state.fallbackCpu
      ? (Math.max(
          0,
          usage.user + usage.system - state.fallbackCpu.user - state.fallbackCpu.system,
        ) /
          (elapsed * 1000)) *
        100
      : null;

  state.fallbackCpu = usage;
  state.fallbackAt = now;
  state.previous.clear();
  state.previousAt = undefined;
  const usedBytes = process.memoryUsage().rss;

  return {
    cpu: { usedPercent: corePercent === null ? null : corePercent / cores, corePercent, cores },
    memory: { usedBytes, totalBytes },
    processes: [
      {
        pid: process.pid,
        name: 'Web server & learning',
        cpuPercent: corePercent,
        memoryBytes: usedBytes,
      },
    ],
    scope: 'web-process',
  };
}
