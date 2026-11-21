import type { ContextRequestReport } from '@agent/core/request-budget/report.js';

import { CONTEXT_BUCKETS, cacheShare, formatTokens, percent, type ChatContextStats } from '../../lib/context-stats';

type Reported = ChatContextStats & { last: ContextRequestReport };

/** Breakdown of the latest request, plus how this chat has managed its context. */
export function ContextPanel({ stats }: { stats: Reported }) {
  const { last } = stats;

  return (
    <div className="context-viz space-y-3 p-3 text-xs">
      <div>
        <h2 className="text-sm font-medium text-foreground">Context</h2>
        <p className="text-muted-foreground">
          {formatTokens(last.estimated)} of {formatTokens(last.window)} tokens ({percent(last.estimated, last.window)}) in the last request
        </p>
      </div>

      <ContextBar report={last} />
      <ContextLegend report={last} />
      <ContextCounters stats={stats} />

      <p className="leading-5 text-muted-foreground">
        Estimated from the last request to {last.model}. Older tool output is cleared at{' '}
        {formatTokens(last.clearAt)} tokens (thin mark); older messages are summarized at {formatTokens(last.ceiling)} (thick mark).
      </p>
    </div>
  );
}

function ContextBar({ report }: { report: ContextRequestReport }) {
  const parts = CONTEXT_BUCKETS.filter((bucket) => report.breakdown[bucket.key] > 0);
  const label = parts.map((bucket) => `${bucket.label} ${formatTokens(report.breakdown[bucket.key])}`).join(', ');
  const mark = (value: number) => `${Math.min(100, (value / report.window) * 100)}%`;

  return (
    <div className="relative pt-1 pb-1" role="img" aria-label={`Context use: ${label}`}>
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted">
        {parts.map((bucket) => (
          <div key={bucket.key} title={`${bucket.label}: ${formatTokens(report.breakdown[bucket.key])} tokens`}
            className="h-full shrink-0"
            style={{ width: mark(report.breakdown[bucket.key]), background: `var(--context-${bucket.slot})` }} />
        ))}
      </div>
      <span aria-hidden="true" className="absolute top-0 bottom-0 w-px bg-muted-foreground" style={{ left: mark(report.clearAt) }} />
      <span aria-hidden="true" className="absolute top-0 bottom-0 w-0.5 bg-foreground" style={{ left: mark(report.ceiling) }} />
    </div>
  );
}

function ContextLegend({ report }: { report: ContextRequestReport }) {
  const rows = CONTEXT_BUCKETS.filter((bucket) => report.breakdown[bucket.key] > 0);

  return (
    <table className="w-full border-collapse tabular-nums">
      <caption className="sr-only">Estimated tokens by kind of content</caption>
      <thead className="sr-only">
        <tr><th scope="col">Content</th><th scope="col">Tokens</th><th scope="col">Share</th></tr>
      </thead>
      <tbody>
        {rows.map((bucket) => (
          <tr key={bucket.key} title={bucket.description}>
            <th scope="row" className="py-0.5 text-left font-normal text-foreground">
              <span aria-hidden="true" className="mr-2 inline-block size-2 rounded-full align-middle"
                style={{ background: `var(--context-${bucket.slot})` }} />
              {bucket.label}
            </th>
            <td className="py-0.5 text-right text-foreground">{formatTokens(report.breakdown[bucket.key])}</td>
            <td className="w-12 py-0.5 text-right text-muted-foreground">{percent(report.breakdown[bucket.key], report.estimated)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ContextCounters({ stats }: { stats: Reported }) {
  const { counts } = stats.last;
  const cache = cacheShare(stats);
  const items: [string, string][] = [
    ['Model requests', String(stats.requests)],
    ['Summaries', String(stats.compactions)],
    ['Clearing passes', String(stats.clearingPasses)],
    ['Results cleared', `${counts.cleared} of ${counts.toolResults}`],
    ['Largest request', formatTokens(stats.peak)],
    ...(cache ? [['Read from cache', cache] as [string, string]] : []),
  ];

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border pt-3 tabular-nums">
      {items.map(([term, value]) => (
        <div key={term} className="flex items-baseline justify-between gap-2">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
