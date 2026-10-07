import type { UsageTotals } from '@agent/core/usage';
import { formatCost, formatTokens } from '../lib/model-usage';

export function UsageMetrics({ totals }: { totals: UsageTotals }) {
  const priced = totals.requests - totals.unpricedRequests;
  const spend = totals.requests > 0 && priced === 0 ? null : totals.costUsd;
  const metrics = [
    { label: 'Estimated spend', value: formatCost(spend), detail: totals.unpricedRequests > 0
      ? `${totals.unpricedRequests.toLocaleString()} unpriced requests excluded` : 'USD · based on configured model rates' },
    { label: 'Total tokens', value: formatTokens(totals.inputTokens + totals.outputTokens),
      detail: `${formatTokens(totals.inputTokens)} input · ${formatTokens(totals.outputTokens)} output` },
    { label: 'Model requests', value: totals.requests.toLocaleString(), detail: 'Chat, summarization and learning' },
  ];

  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      {metrics.map(({ label, value, detail }) => (
        <div key={label} className="rounded-xl border border-border p-4">
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{value}</dd>
          <dd className="mt-2 text-xs leading-5 text-muted-foreground">{detail}</dd>
        </div>
      ))}
    </dl>
  );
}

export function UsageCoverage({ totals }: { totals: UsageTotals }) {
  return (
    <div className="space-y-1 text-xs leading-5 text-muted-foreground">
      <p>Estimates use rates from <code>models.yml</code>. Your provider’s invoice is authoritative; subscriptions, taxes and external usage are excluded.</p>
      {totals.unpricedRequests > 0 && <p>{totals.unpricedRequests.toLocaleString()} requests are unpriced. Add input, output and applicable cache rates to <code>models.yml</code> for future estimates.</p>}
      {totals.unreportedRequests > 0 && <p>{totals.unreportedRequests.toLocaleString()} requests have incomplete token reporting. Token totals include only reported counts.</p>}
    </div>
  );
}
