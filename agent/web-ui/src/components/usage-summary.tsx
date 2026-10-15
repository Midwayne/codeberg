import type { UsageTotals } from '@agent/core/usage';
import { formatTokens } from '../lib/model-usage';

export function UsageMetrics({ totals }: { totals: UsageTotals }) {
  const metrics = [
    { label: 'Input tokens', value: formatTokens(totals.inputTokens) },
    { label: 'Output tokens', value: formatTokens(totals.outputTokens) },
  ];

  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {metrics.map(({ label, value }) => (
        <div key={label} className="rounded-xl border border-border p-4">
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function UsageCoverage({ totals }: { totals: UsageTotals }) {
  return (
    <div className="space-y-1 text-xs leading-5 text-muted-foreground">
      <p>Provider-reported tokens from chat, summarization and learning calls.</p>
      {totals.unreportedRequests > 0 && <p>{totals.unreportedRequests.toLocaleString()} requests have incomplete token reporting. Token totals include only reported counts.</p>}
    </div>
  );
}
