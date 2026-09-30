import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, statfsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';

import { ProcessMonitor, parseProcessSnapshot } from './process-resources.js';
import { DISK_MS, SAMPLE_MS, type ResourceWorkerData } from './resource-monitor.js';
import type { ResourceSample } from './resources.js';

// Standalone/older-daemon fallback. Synchronous filesystem work happens only on
// this dedicated thread, avoiding the chat event loop AND its shared libuv pool.
const options = workerData as ResourceWorkerData;
const env = options.env ?? process.env;
const monitor = new ProcessMonitor({ launcherPid: Number(env.CODEBERG_RESOURCE_ROOT_PID) || undefined,
  daemonUrl: options.daemonUrl, readProcesses: async () => parseProcessSnapshot(execFileSync('ps',
    ['-ax', '-o', 'pid=,ppid=,time=,rss=,lstart=,comm='], { encoding: 'utf8', timeout: 3000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } })) });
let disk: ResourceSample['disk'] = null;
let latest: ResourceSample | undefined;
let sampling = false;
let refresh: NodeJS.Timeout | undefined;

async function sample() {
  if (sampling) return;
  sampling = true;
  try {
    latest = { ...await monitor.sample(), timestamp: Date.now(), disk };
    parentPort?.postMessage({ kind: 'sample', sample: latest });
  } finally { sampling = false; }
}

function scanDisk() {
  const paths = [options.home, options.sessionsDir, options.learningRoot];
  if (env.CODEBERG_LOG_DIR) paths.push(env.CODEBERG_LOG_DIR);
  if (env.CBERG_MODEL) {
    paths.push(env.CBERG_MODEL);
    for (const name of ['tokenizer.json', 'vocab.txt', 'tokenizer_config.json', 'special_tokens_map.json']) paths.push(join(dirname(env.CBERG_MODEL), name));
  }
  try {
    if (env.CBERG_INDEX_PATH) {
      const base = resolve(env.CBERG_INDEX_PATH);
      try { paths.push(...readdirSync(dirname(base)).filter((name) => name === basename(base) || name.startsWith(basename(base) + '.')).map((name) => join(dirname(base), name))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    const visited = new Set<string>();
    const deadline = performance.now() + 30_000;
    let bytes = 0;
    for (const path of paths) bytes += directoryBytes(path, visited, deadline);
    let home = options.home;
    let fs;
    for (;;) {
      try { fs = statfsSync(home); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(home) === home) throw error; home = dirname(home); }
    }
    disk = { totalBytes: fs.blocks * fs.bsize, availableBytes: fs.bavail * fs.bsize, codebergBytes: bytes, sampledAt: Date.now() };
    if (latest) { latest = { ...latest, disk }; parentPort?.postMessage({ kind: 'sample', sample: latest }); }
  } catch { /* Retain the last complete snapshot, never a partial scan total. */ }
}

function directoryBytes(path: string, visited: Set<string>, deadline: number): number {
  if (performance.now() > deadline) throw new Error('disk scan time budget exceeded');
  let info;
  try { info = lstatSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error; }
  if (!info.isFile() && !info.isDirectory()) return 0;
  const key = `${info.dev}:${info.ino}`;
  if (visited.has(key)) return 0;
  visited.add(key);
  if (info.isFile()) return info.blocks * 512;
  let bytes = 0;
  for (const name of readdirSync(path)) bytes += directoryBytes(join(path, name), visited, deadline);
  return bytes;
}

void sample().catch(() => undefined);
setInterval(() => void sample().catch(() => undefined), SAMPLE_MS);
setTimeout(scanDisk, 0);
setInterval(scanDisk, DISK_MS);
parentPort?.on('message', (message: { kind: string }) => {
  if (message.kind === 'refreshDisk' && !refresh) refresh = setTimeout(() => { refresh = undefined; scanDisk(); }, 5000);
});
