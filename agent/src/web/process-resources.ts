import { execFile } from 'node:child_process';
import { cpus, totalmem } from 'node:os';
import { basename } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ProcessSnapshot {
  pid: number;
  ppid: number;
  command: string;
  cpuMs: number;
  rssBytes: number;
  startedAt: number;
}

export interface ProcessUsage {
  cpu: { usedPercent: number | null; corePercent: number | null; cores: number };
  memory: { usedBytes: number; totalBytes: number };
  processes: { pid: number; name: string; cpuPercent: number | null; memoryBytes: number }[];
  scope:
    | 'managed-stack'
    | 'web-and-daemon'
    | 'daemon-process-tree'
    | 'web-process-tree'
    | 'web-process';
}

/** Interval CPU and resident memory for this Codeberg instance, not the host. */
export class ProcessMonitor {
  private previous = new Map<string, number>();
  private previousAt?: number;
  private names = new Map<string, string>();
  private fallbackCpu?: NodeJS.CpuUsage;
  private fallbackAt?: number;

  constructor(
    private readonly options: {
      pid?: number;
      launcherPid?: number;
      daemonUrl?: string;
      cores?: number;
      totalMemoryBytes?: number;
      readProcesses?: () => Promise<ProcessSnapshot[]>;
      readArguments?: (pid: number) => Promise<string>;
      embeddingModel?: string;
      embeddingBackend?: string;
      now?: () => number;
    } = {},
  ) {}

  async sample(): Promise<ProcessUsage> {
    const pid = this.options.pid ?? process.pid;
    const cores = Math.max(1, this.options.cores ?? cpus().length);
    const totalBytes = this.options.totalMemoryBytes ?? totalmem();

    try {
      return await this.sampleProcesses(pid, cores, totalBytes);
    } catch {
      return this.sampleWebProcess(cores, totalBytes);
    }
  }

  private async sampleProcesses(
    pid: number,
    cores: number,
    totalBytes: number,
  ): Promise<ProcessUsage> {
    const clock = this.options.now ?? Date.now;
    const [capture, daemonPid] = await Promise.all([
      (this.options.readProcesses ?? readProcesses)().then((snapshot) => ({
        snapshot,
        now: clock(),
      })),
      localDaemonPid(this.options.daemonUrl),
    ]);

    const { snapshot, now } = capture;
    const own = snapshot.find((item) => item.pid === pid);
    if (!own) throw new Error('web process missing from process snapshot');

    const candidate = this.options.launcherPid ?? own.ppid;
    const launcher = snapshot.find(
      (item) => item.pid === candidate && basename(item.command) === 'codeberg',
    );
    const daemon = snapshot.find(
      (item) => item.pid === daemonPid && basename(item.command) === 'codeberg-d',
    );
    const roots = [pid, ...(launcher ? [launcher.pid] : []), ...(daemon ? [daemon.pid] : [])];
    const selected = selectProcessTree(snapshot, roots);
    await this.resolveNames(selected);
    const scope = launcher ? 'managed-stack' : daemon ? 'web-and-daemon' : 'web-process-tree';

    return this.processUsage(selected, { pid, cores, totalBytes, now, scope });
  }

  private async resolveNames(selected: ProcessSnapshot[]): Promise<void> {
    const names = new Map<string, string>();
    await Promise.all(
      selected.map(async (item) => {
        const key = `${item.pid}:${item.startedAt}:${item.command}`;
        let name = this.names.get(key);
        if (name === undefined) {
          name = workerName(
            item.command,
            '',
            this.options.embeddingModel,
            this.options.embeddingBackend,
          );
          if (
            /^python(?:\d+(?:\.\d+)*)?$/.test(basename(item.command)) &&
            name === basename(item.command)
          ) {
            name = workerName(
              item.command,
              await (this.options.readArguments ?? readArguments)(item.pid),
              this.options.embeddingModel,
              this.options.embeddingBackend,
            );
          }
        }

        names.set(key, name);
      }),
    );
    this.names = names;
  }

  private processUsage(
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

    const elapsed = this.previousAt === undefined ? undefined : now - this.previousAt;
    const current = new Map(selected.map((item) => [`${item.pid}:${item.startedAt}`, item.cpuMs]));
    const processes = selected.map((item) => this.processMeasurement(item, pid, elapsed));

    const complete = processes.every((item) => item.cpuPercent !== null);
    const corePercent = complete
      ? processes.reduce((sum, item) => sum + (item.cpuPercent ?? 0), 0)
      : null;
    this.previous = current;
    this.previousAt = now;
    this.fallbackAt = undefined;
    this.fallbackCpu = undefined;

    return {
      cpu: { usedPercent: corePercent === null ? null : corePercent / cores, corePercent, cores },
      memory: { usedBytes: processes.reduce((sum, item) => sum + item.memoryBytes, 0), totalBytes },
      processes,
      scope,
    };
  }

  private processMeasurement(item: ProcessSnapshot, pid: number, elapsed: number | undefined) {
    const key = `${item.pid}:${item.startedAt}`;
    const previous = this.previous.get(key);
    // A newly spawned child contributes CPU since birth. A newly discovered,
    // already-running process needs a baseline before attributing its CPU.
    const baseline =
      previous ??
      (this.previousAt !== undefined && item.startedAt >= this.previousAt ? 0 : undefined);
    const cpuPercent =
      elapsed && elapsed > 0 && baseline !== undefined
        ? (Math.max(0, item.cpuMs - baseline) / elapsed) * 100
        : null;

    return {
      pid: item.pid,
      name:
        item.pid === pid
          ? 'Web server & learning'
          : (this.names.get(`${item.pid}:${item.startedAt}:${item.command}`) ??
            processLabel(item.command)),
      cpuPercent,
      memoryBytes: item.rssBytes,
    };
  }

  private sampleWebProcess(cores: number, totalBytes: number): ProcessUsage {
    // Unsupported platforms or an unavailable ps still get truthful web-only
    // measurements. Never substitute whole-host usage for missing process data.
    const now = (this.options.now ?? Date.now)();
    const usage = process.cpuUsage();
    const elapsed = this.fallbackAt === undefined ? undefined : now - this.fallbackAt;
    const corePercent =
      elapsed && elapsed > 0 && this.fallbackCpu
        ? (Math.max(
            0,
            usage.user + usage.system - this.fallbackCpu.user - this.fallbackCpu.system,
          ) /
            (elapsed * 1000)) *
          100
        : null;

    this.fallbackCpu = usage;
    this.fallbackAt = now;
    this.previous.clear();
    this.previousAt = undefined;
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
}

function processLabel(command: string): string {
  const name = basename(command);

  return name === 'codeberg'
    ? 'Launcher'
    : name === 'codeberg-d'
      ? 'Daemon'
      : name === 'cberg-index'
        ? 'Indexer'
        : name;
}

export function workerName(command: string, arguments_ = '', model = '', backend = ''): string {
  let embedding = command.includes('/embedding-venv/');
  let search = command.includes('/searxng/venv/');
  const fields = arguments_.trim().split(/\s+/);
  fields.forEach((field, i) => {
    if (field === '-m' && fields[i + 1] === 'searx.webapp') search = true;

    if (basename(field) === 'embedding_worker.py') {
      embedding = true;
      backend = fields[i + 1] ?? backend;
      if (fields[i + 2]) model = fields.slice(i + 2).join(' ');
    }
  });
  if (search) return 'Web search — SearXNG';

  if (!embedding) return processLabel(command);

  const lower = model.toLowerCase();
  if (!backend) {
    if (lower.endsWith('-mlx') || lower.includes('-mlx/')) backend = 'mlx';
    else if (lower.endsWith('.gguf') || lower.includes('-llama')) backend = 'llama';
  }

  const details = [
    ...(lower.includes('qwen3') ? ['Qwen3'] : []),
    ...(backend === 'mlx' ? ['MLX'] : backend === 'llama' ? ['llama.cpp'] : []),
  ];

  return details.length ? `Embedding worker — ${details.join('/')}` : 'Embedding worker';
}

async function readArguments(pid: number): Promise<string> {
  try {
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'args='], {
      encoding: 'utf8',
      timeout: 500,
      maxBuffer: 64 * 1024,
    });

    return stdout.slice(0, 8192);
  } catch {
    return '';
  }
}

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

function cpuTimeMs(value: string): number | undefined {
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

async function readProcesses(): Promise<ProcessSnapshot[]> {
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

async function localDaemonPid(daemonUrl?: string): Promise<number | undefined> {
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
