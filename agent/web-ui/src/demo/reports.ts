import type { UsageReport, UsageTotals } from '@agent/core/usage';
import type { ResourceSample, ResourceUsage } from '../lib/resources';

const totals: UsageTotals = {
  requests: 8, inputTokens: 18000, outputTokens: 3200, cacheReadTokens: 4000,
  cacheWriteTokens: 0, costUsd: 0.08, unpricedRequests: 0, unreportedRequests: 0,
};

export function usageReport(url: URL): UsageReport {
  const start = url.searchParams.get('start') ?? '2026-10-01';
  const end = url.searchParams.get('end') ?? '2026-10-08';

  return {
    totals, start, end, page: Number(url.searchParams.get('page') ?? 1), pageSize: 20,
    daily: [{ ...totals, date: start }], models: [{ ...totals, model: 'Demo model' }],
    records: [{ id: 'demo-call', timestamp: Date.now(), model: 'Demo model', key: 'demo:model',
      kind: 'chat', projectName: 'Codeberg demo', inputTokens: 18000, outputTokens: 3200,
      cacheReadTokens: 4000, cacheWriteTokens: 0, costUsd: 0.08 }],
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
