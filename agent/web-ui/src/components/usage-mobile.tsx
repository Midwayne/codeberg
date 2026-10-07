import type { UsageRecord, UsageReport } from '@agent/core/usage';
import { formatCost, formatTokens } from '../lib/model-usage';

export function UsageModelList({ models }: Pick<UsageReport, 'models'>) {
  return (
    <ul className="divide-y divide-border rounded-xl border border-border sm:hidden">
      {models.map((model) => <li key={model.model} className="space-y-2 p-4">
        <div className="break-all text-sm font-medium">{model.model}</div>
        <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground tabular-nums">
          <span>{model.requests.toLocaleString()} requests · {formatTokens(model.inputTokens + model.outputTokens)} tokens</span>
          <span className="font-medium text-foreground">{formatCost(model.unpricedRequests === model.requests ? null : model.costUsd)}{model.unpricedRequests > 0 && model.unpricedRequests < model.requests ? ' + unpriced' : ''}</span>
        </div>
      </li>)}
    </ul>
  );
}

export function UsageRequestList({ records }: Pick<UsageReport, 'records'>) {
  return (
    <ul className="divide-y divide-border rounded-xl border border-border sm:hidden">
      {records.map((row) => <li key={row.id} className="space-y-2 p-4"><MobileRequest row={row} /></li>)}
    </ul>
  );
}

function MobileRequest({ row }: { row: UsageRecord }) {
  const timestamp = new Date(row.timestamp).toISOString();
  const token = (value: number | null) => value === null ? 'Not reported' : formatTokens(value);

  return (
    <>
      <div className="flex flex-wrap justify-between gap-2 text-xs tabular-nums">
        <time dateTime={timestamp} className="text-muted-foreground">{timestamp.slice(0, 10)} {timestamp.slice(11, 16)} UTC</time>
        <span className="font-medium">{row.costUsd === null ? 'Unpriced' : formatCost(row.costUsd)}</span>
      </div>
      <p className="break-all text-sm font-medium">{row.model}</p>
      <p className="break-words text-xs text-muted-foreground">{row.projectName ?? row.project ?? 'Unassigned'} · {row.kind === 'learning' ? 'Learning' : 'Chat'}</p>
      <p className="text-xs text-muted-foreground tabular-nums">{token(row.inputTokens)} input · {token(row.outputTokens)} output</p>
      <CacheDetails row={row} />
    </>
  );
}

export function CacheDetails({ row }: { row: UsageRecord }) {
  if (!row.cacheReadTokens && !row.cacheWriteTokens) return null;

  return (
    <details className="text-xs text-muted-foreground tabular-nums">
      <summary className="min-h-7 cursor-pointer py-1">Cache tokens</summary>
      <p className="py-1">{row.cacheReadTokens?.toLocaleString() ?? 'Not reported'} read · {row.cacheWriteTokens?.toLocaleString() ?? 'Not reported'} written</p>
    </details>
  );
}
