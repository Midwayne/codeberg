import { KIND_LABELS, type ReviewDashboard } from '../lib/training';

export type TrainingSummaryProps = { stats: ReviewDashboard['stats'] };

export function TrainingSummary({ stats }: TrainingSummaryProps) {
  const reviewed = stats.training + stats.eval + stats.dismissed;
  const current = reviewed + stats.ready;
  const progress = current ? Math.round((100 * reviewed) / current) : 0;
  return (
    <section className="border-b border-border pb-6" aria-label="Training progress">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Review progress</p>
          <p className="text-xs text-muted-foreground">
            {reviewed} of {current} current examples reviewed · {stats.stale} outdated revisions excluded
          </p>
        </div>
        <span className="text-lg font-semibold tabular-nums">{progress}%</span>
      </div>
      <div
        role="progressbar"
        aria-label="Review progress"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
      </div>
      <TrainingCounts stats={stats} />
      {stats.ready > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          In the queue:{' '}
          {Object.entries(stats.by_kind)
            .map(([kind, count]) => `${count} ${KIND_LABELS[kind as keyof typeof KIND_LABELS]?.toLowerCase() ?? kind}`)
            .join(' · ')}
        </p>
      )}
    </section>
  );
}

export type TrainingCountsProps = Pick<Parameters<typeof TrainingSummary>[0], 'stats'>;

export function TrainingCounts({ stats }: TrainingCountsProps) {
  return (
    <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {(
        [
          ['To review', stats.ready, 'Awaiting your decision'],
          ['Training', stats.training, 'Approved examples'],
          ['Evaluation', stats.eval, 'Held-out checks'],
          ['Set aside', stats.dismissed, 'Not selected'],
        ] as const
      ).map(([label, value, caption]) => (
        <div key={label}>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
          <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">{caption}</p>
        </div>
      ))}
    </div>
  );
}
