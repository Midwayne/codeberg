import type { UsageRecord, UsageReport } from '@agent/core/usage';
import { summarizeUsage } from '../../../src/web/usage/summary';
import type { ResourceSample, ResourceUsage } from '../lib/resources';

export function usageReport(url: URL): UsageReport {
  const start = url.searchParams.get('start') ?? '2026-10-01';
  const end = url.searchParams.get('end') ?? '2026-10-08';
  const kind = url.searchParams.get('kind') ?? 'all';
  const page = Number(url.searchParams.get('page') ?? 1);
  const records: UsageRecord[] = (['chat', 'learning'] as const).map((activity, index) => ({
    id: `demo-${activity}`, timestamp: Date.parse(start) + index * 60_000,
    model: 'Demo model', key: 'demo:model', kind: activity, projectName: 'Codeberg demo',
    inputTokens: index ? 6000 : 12000, outputTokens: index ? 800 : 2400,
    cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: null,
  }));
  const rows = records.filter((row) => kind === 'all' || row.kind === kind);

  return {
    ...summarizeUsage(rows), start, end, page, pageSize: 25,
    records: rows.slice((page - 1) * 25, page * 25),
  };
}

export function resourceReport(): ResourceUsage {
  const current: ResourceSample = {
    timestamp: Date.now(), cpu: { usedPercent: 2.5, corePercent: 20, cores: 8 },
    memory: { usedBytes: 256 * 1024 ** 2, totalBytes: 16 * 1024 ** 3 },
    disk: { totalBytes: 512 * 1024 ** 3, availableBytes: 320 * 1024 ** 3, codebergBytes: 120 * 1024 ** 2 },
    processes: [{ pid: 100, name: 'Demo web server', cpuPercent: 2.5, memoryBytes: 256 * 1024 ** 2 }],
    scope: 'web-process',
  };
  const history = Array.from({ length: 30 }, (_, i) => ({ ...current,
    timestamp: current.timestamp - (29 - i) * 10_000,
    cpu: { ...current.cpu, usedPercent: 2 + Math.sin(i / 3), corePercent: 16 + Math.sin(i / 3) * 8 },
  }));

  return { current, history, retentionMs: 3600_000, sampleIntervalMs: 10_000 };
}
