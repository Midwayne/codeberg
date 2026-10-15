import type { UsageFilter, UsageSummary, UsageTotals } from '@agent/core/usage';
import { formatTokens } from '../lib/model-usage';

export function UsageMetrics({ totals, kinds, kind }: Pick<UsageSummary, 'totals' | 'kinds'> & { kind: UsageFilter }) {
  const metrics = [
    { label: 'Input tokens', field: 'inputTokens' },
    { label: 'Output tokens', field: 'outputTokens' },
  ] as const;

  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {metrics.map(({ label, field }) => (
        <div key={label} className="rounded-xl border border-border p-4">
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="mt-3">
            <span className="text-2xl font-semibold tracking-tight tabular-nums">{formatTokens(totals[field])}</span>
            {kind === 'all' && <dl aria-label={`${label} by activity`} className="mt-3 space-y-1 border-t border-border pt-3 text-sm tabular-nums">
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Chat</dt><dd>{formatTokens(kinds.chat[field])}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Learning</dt><dd>{formatTokens(kinds.learning[field])}</dd></div>
            </dl>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function UsageCoverage({ totals }: { totals: UsageTotals }) {
  return (
    <div className="space-y-1 text-xs leading-5 text-muted-foreground">
      <p>Provider-reported tokens. Chat includes conversation summarization; Learning includes background learning model calls.</p>
      {totals.unreportedRequests > 0 && <p>{totals.unreportedRequests.toLocaleString()} requests have incomplete token reporting. Token totals include only reported counts.</p>}
    </div>
  );
}
