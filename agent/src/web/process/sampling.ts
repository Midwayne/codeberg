import { cpus, totalmem } from 'node:os';
import { basename } from 'node:path';
import { readArguments, workerName } from './labels.js';
import { processUsage, sampleWebProcess } from './measurement.js';
import { localDaemonPid, readProcesses, selectProcessTree } from './snapshot.js';
import type { ProcessMonitorState } from './state.js';
import type { ProcessSnapshot, ProcessUsage } from './types.js';

export async function sample(state: ProcessMonitorState): Promise<ProcessUsage> {
  const pid = state.options.pid ?? process.pid;
  const cores = Math.max(1, state.options.cores ?? cpus().length);
  const totalBytes = state.options.totalMemoryBytes ?? totalmem();

  try {
    return await sampleProcesses(state, pid, cores, totalBytes);
  } catch {
    return sampleWebProcess(state, cores, totalBytes);
  }
}

export async function sampleProcesses(
  state: ProcessMonitorState,
  pid: number,
  cores: number,
  totalBytes: number,
): Promise<ProcessUsage> {
  const clock = state.options.now ?? Date.now;
  const [capture, daemonPid] = await Promise.all([
    (state.options.readProcesses ?? readProcesses)().then((snapshot) => ({
      snapshot,
      now: clock(),
    })),
    localDaemonPid(state.options.daemonUrl),
  ]);

  const { snapshot, now } = capture;
  const own = snapshot.find((item) => item.pid === pid);
  if (!own) throw new Error('web process missing from process snapshot');

  const candidate = state.options.launcherPid ?? own.ppid;
  const launcher = snapshot.find(
    (item) => item.pid === candidate && basename(item.command) === 'codeberg',
  );
  const daemon = snapshot.find(
    (item) => item.pid === daemonPid && basename(item.command) === 'codeberg-d',
  );
  const roots = [pid, ...(launcher ? [launcher.pid] : []), ...(daemon ? [daemon.pid] : [])];
  const selected = selectProcessTree(snapshot, roots);
  await resolveNames(state, selected);
  const scope = launcher ? 'managed-stack' : daemon ? 'web-and-daemon' : 'web-process-tree';

  return processUsage(state, selected, { pid, cores, totalBytes, now, scope });
}

export async function resolveNames(
  state: ProcessMonitorState,
  selected: ProcessSnapshot[],
): Promise<void> {
  const names = new Map<string, string>();
  await Promise.all(
    selected.map(async (item) => {
      const key = `${item.pid}:${item.startedAt}:${item.command}`;
      let name = state.names.get(key);
      if (name === undefined) {
        name = workerName(
          item.command,
          '',
          state.options.embeddingModel,
          state.options.embeddingBackend,
        );
        if (
          /^python(?:\d+(?:\.\d+)*)?$/.test(basename(item.command)) &&
          name === basename(item.command)
        ) {
          name = workerName(
            item.command,
            await (state.options.readArguments ?? readArguments)(item.pid),
            state.options.embeddingModel,
            state.options.embeddingBackend,
          );
        }
      }

      names.set(key, name);
    }),
  );
  state.names = names;
}
