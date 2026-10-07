import type { UsageRecord, UsageSummary, UsageTotals } from '../../core/usage.js';

function empty(): UsageTotals {
  return { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    costUsd: 0, unpricedRequests: 0, unreportedRequests: 0 };
}

function add(total: UsageTotals, row: UsageRecord) {
  total.requests++;
  total.inputTokens += row.inputTokens ?? 0;
  total.outputTokens += row.outputTokens ?? 0;
  total.cacheReadTokens += row.cacheReadTokens ?? 0;
  total.cacheWriteTokens += row.cacheWriteTokens ?? 0;
  total.costUsd += row.costUsd ?? 0;
  total.unpricedRequests += Number(row.costUsd === null);
  total.unreportedRequests += Number(row.inputTokens === null || row.outputTokens === null);
}

export function summarizeUsage(rows: UsageRecord[]): UsageSummary {
  const totals = empty();
  const daily = new Map<string, UsageTotals>();
  const models = new Map<string, UsageTotals>();

  for (const row of rows) {
    const date = new Date(row.timestamp).toISOString().slice(0, 10);
    const day = daily.get(date) ?? empty();
    const model = models.get(row.model) ?? empty();
    add(totals, row);
    add(day, row);
    add(model, row);
    daily.set(date, day);
    models.set(row.model, model);
  }

  return { totals,
    daily: [...daily].sort(([a], [b]) => a.localeCompare(b)).map(([date, total]) => ({ date, ...total })),
    models: [...models].sort(([a], [b]) => a.localeCompare(b)).map(([model, total]) => ({ model, ...total })),
  };
}
