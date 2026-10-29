import type { UsageRecord, UsageReport } from '@agent/core/usage';
import { formatTokens } from '../lib/model-usage';
import { usageActivityLabels } from '../lib/usage-activities';

export function UsageModelList({ models }: Pick<UsageReport, 'models'>) {
  return (
    <ul className="divide-y divide-border rounded-xl border border-border sm:hidden">
      {models.map((model) => <li key={model.model} className="space-y-2 p-4">
        <div className="break-all text-sm font-medium">{model.model}</div>
        <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground tabular-nums">
          <span>{model.requests.toLocaleString()} requests</span>
          <span>{formatTokens(model.inputTokens)} input · {formatTokens(model.outputTokens)} output</span>
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
      </div>
      <p className="break-all text-sm font-medium">{row.model}</p>
      <p className="break-words text-xs text-muted-foreground">{row.projectName ?? row.project ?? 'Unassigned'} · {usageActivityLabels[row.kind]}</p>
      <p className="text-xs text-muted-foreground tabular-nums">{token(row.inputTokens)} input · {token(row.outputTokens)} output</p>
    </>
  );
}
