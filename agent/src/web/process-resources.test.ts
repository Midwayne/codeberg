import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProcessMonitor, parseProcessSnapshot, selectProcessTree, workerName, type ProcessSnapshot } from './process-resources.js';

const MB = 1024 * 1024;
afterEach(() => { vi.unstubAllGlobals(); });
function row(pid: number, ppid: number, command: string, rssBytes = MB, cpuMs = 0, startedAt = 0): ProcessSnapshot {
  return { pid, ppid, command, rssBytes, cpuMs, startedAt };
}

describe('Codeberg process attribution', () => {
  it('names known Python workers by their Codeberg component and preserves unknown Python names', () => {
    expect(workerName('/home/.codeberg/embedding-venv/bin/python', '', '/models/qwen3-fp16-mlx', 'mlx')).toBe('Embedding worker — Qwen3/MLX');
    expect(workerName('/home/.codeberg/searxng/venv/bin/python')).toBe('Web search — SearXNG');
    expect(workerName('python3', 'python3 /app/embedding_worker.py mlx /models/qwen3-fp16-mlx')).toBe('Embedding worker — Qwen3/MLX');
    expect(workerName('python', 'python -m searx.webapp')).toBe('Web search — SearXNG');
    expect(workerName('python', 'python /app/custom.py')).toBe('python');
  });

  it('resolves a worker name once per process identity rather than on every sample', async () => {
    const rows = [row(20, 1, 'node'), row(30, 20, 'python')];
    const readArguments = vi.fn(async () => 'python -m searx.webapp');
    const monitor = new ProcessMonitor({ pid: 20, readProcesses: async () => rows, readArguments });
    expect((await monitor.sample()).processes.find((item) => item.pid === 30)?.name).toBe('Web search — SearXNG');
    await monitor.sample();
    expect(readArguments).toHaveBeenCalledTimes(1);
    rows[1]!.startedAt = 100;
    await monitor.sample();
    expect(readArguments).toHaveBeenCalledTimes(2);
  });
  it('selects the launcher, daemon, indexer, and managed workers without counting unrelated apps or the browser', () => {
    const rows = [
      row(10, 1, '/bin/codeberg'), row(20, 10, '/bin/node'), row(30, 10, '/bin/codeberg-d'),
      row(40, 30, '/bin/cberg-index'), row(50, 40, '/bin/python3'), row(60, 20, '/bin/dbmcp'),
      row(70, 1, '/bin/unrelated', 40_000 * MB), row(80, 10, '/usr/bin/xdg-open'),
      row(90, 80, '/bin/firefox'), row(100, 20, '/bin/ps'),
      row(110, 1, '/bin/codeberg-d', 40_000 * MB),
    ];
    expect(selectProcessTree(rows, [10, 20]).map((item) => item.pid).sort((a, b) => a - b)).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it('measures interval CPU and summed resident memory, with no unrelated host usage', async () => {
    let now = 10_000;
    let rows = [row(10, 1, 'codeberg', 10 * MB, 200), row(20, 10, 'node', 100 * MB, 300), row(30, 10, 'codeberg-d', 200 * MB, 500), row(40, 1, 'other', 40_000 * MB, 900_000)];
    const monitor = new ProcessMonitor({ pid: 20, cores: 4, totalMemoryBytes: 48_000 * MB, readProcesses: async () => rows, now: () => now });
    expect((await monitor.sample()).cpu.usedPercent).toBeNull();
    now += 10_000;
    rows = [row(10, 1, 'codeberg', 10 * MB, 200), row(20, 10, 'node', 100 * MB, 1300), row(30, 10, 'codeberg-d', 200 * MB, 1500), row(40, 1, 'other', 45_000 * MB, 999_000)];
    const sample = await monitor.sample();
    expect(sample.cpu.corePercent).toBeCloseTo(20);
    expect(sample.cpu.usedPercent).toBeCloseTo(5);
    expect(sample.memory.usedBytes).toBe(310 * MB);
    expect(sample.scope).toBe('managed-stack');
  });

  it('handles restarts and PID reuse without counting an old lifetime of CPU', async () => {
    let now = 10_000;
    let rows = [row(20, 1, 'node', MB, 100, 0), row(30, 20, 'worker', MB, 500, 0)];
    const monitor = new ProcessMonitor({ pid: 20, cores: 4, readProcesses: async () => rows, now: () => now });
    await monitor.sample();
    now += 10_000;
    rows = [row(20, 1, 'node', MB, 200, 0), row(30, 20, 'worker', MB, 50, 15_000)];
    expect((await monitor.sample()).cpu.corePercent).toBeCloseTo(1.5);
  });

  it('parses macOS and Linux CPU-time formats and commands with spaces', () => {
    const snapshots = parseProcessSnapshot([
      ' 20 10 1:02.50 1024 Wed Sep 30 07:00:00 2026 /usr/local/bin/node',
      ' 30 10 1-02:03:04 2048 Wed Sep 30 07:00:00 2026 /some path/codeberg-d',
      'invalid row',
    ].join('\n'));
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toMatchObject({ pid: 20, ppid: 10, cpuMs: 62_500, rssBytes: MB });
    expect(snapshots[1]).toMatchObject({ pid: 30, cpuMs: 93_784_000, rssBytes: 2 * MB, command: '/some path/codeberg-d' });
  });

  it('can sample the actual local web process without a running daemon', async () => {
    const sample = await new ProcessMonitor().sample();
    expect(sample.processes.some((item) => item.pid === process.pid)).toBe(true);
    expect(sample.memory.usedBytes).toBeGreaterThan(0);
    expect(sample.scope).not.toBe('web-process');
  });

  it('includes a separately launched local daemon and its indexer, but ignores remote PIDs', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ pid: 30 })));
    vi.stubGlobal('fetch', fetch);
    const rows = [row(20, 1, 'node'), row(30, 1, 'codeberg-d'), row(40, 30, 'cberg-index')];
    const local = await new ProcessMonitor({ pid: 20, daemonUrl: 'http://127.0.0.1:48080', readProcesses: async () => rows }).sample();
    expect(local.scope).toBe('web-and-daemon');
    expect(local.memory.usedBytes).toBe(3 * MB);
    fetch.mockClear();
    const remote = await new ProcessMonitor({ pid: 20, daemonUrl: 'https://remote.example', readProcesses: async () => rows }).sample();
    expect(remote.scope).toBe('web-process-tree');
    expect(remote.memory.usedBytes).toBe(MB);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('labels a failed process snapshot as web-only rather than inventing host totals', async () => {
    const sample = await new ProcessMonitor({ readProcesses: async () => { throw new Error('ps unavailable'); } }).sample();
    expect(sample.scope).toBe('web-process');
    expect(sample.processes).toHaveLength(1);
    expect(sample.processes[0]?.pid).toBe(process.pid);
    expect(sample.memory.usedBytes).toBeLessThan(sample.memory.totalBytes);
  });
});
