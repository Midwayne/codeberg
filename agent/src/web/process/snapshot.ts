import { basename } from 'node:path';
import { execFileAsync } from './labels.js';
import type { ProcessSnapshot } from './types.js';

export function selectProcessTree(snapshot: ProcessSnapshot[], roots: number[]): ProcessSnapshot[] {
  const selected = new Set(roots);
  const blocked = new Set<number>();
  // The user's browser is not a Codeberg worker; nor is this sampler's ps.
  const excluded =
    /^(?:ps|open|xdg-open|firefox|chrome|chromium(?:-browser)?|safari|google chrome(?: helper.*)?|microsoft edge(?: helper.*)?)(?:\.exe)?$/i;
  for (const item of snapshot) if (excluded.test(basename(item.command))) blocked.add(item.pid);

  let changed = true;
  while (changed) {
    changed = false;
    for (const item of snapshot) {
      if (blocked.has(item.ppid) && !blocked.has(item.pid)) {
        blocked.add(item.pid);
        changed = true;
      }

      if (selected.has(item.ppid) && !selected.has(item.pid) && !blocked.has(item.pid)) {
        selected.add(item.pid);
        changed = true;
      }
    }
  }

  return snapshot.filter((item) => selected.has(item.pid) && !blocked.has(item.pid));
}

export function parseProcessSnapshot(output: string): ProcessSnapshot[] {
  const rows: ProcessSnapshot[] = [];
  for (const line of output.split('\n')) {
    const match =
      /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.+?)\s*$/.exec(line);
    if (!match) continue;

    const cpuMs = cpuTimeMs(match[3]);
    const startedAt = Date.parse(match[5]);
    if (cpuMs === undefined || !Number.isFinite(startedAt)) continue;

    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      cpuMs,
      rssBytes: Number(match[4]) * 1024,
      startedAt,
      command: match[6],
    });
  }

  return rows;
}

export function cpuTimeMs(value: string): number | undefined {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(value);
  if (!match) return undefined;

  return (
    (Number(match[1] ?? 0) * 86400 +
      Number(match[2] ?? 0) * 3600 +
      Number(match[3]) * 60 +
      Number(match[4])) *
    1000
  );
}

export async function readProcesses(): Promise<ProcessSnapshot[]> {
  const { stdout } = await execFileAsync(
    'ps',
    ['-ax', '-o', 'pid=,ppid=,time=,rss=,lstart=,comm='],
    {
      encoding: 'utf8',
      timeout: 3000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C' },
    },
  );

  return parseProcessSnapshot(stdout);
}

export async function localDaemonPid(daemonUrl?: string): Promise<number | undefined> {
  if (!daemonUrl) return undefined;

  try {
    const url = new URL('/health', daemonUrl);
    // A remote daemon's PID is meaningless on this machine.
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return undefined;

    const response = await fetch(url, { signal: AbortSignal.timeout(1500), redirect: 'error' });
    if (!response.ok) return undefined;

    const body = (await response.json()) as { pid?: number };

    return typeof body.pid === 'number' && Number.isInteger(body.pid) && body.pid > 0
      ? body.pid
      : undefined;
  } catch {
    return undefined;
  }
}
