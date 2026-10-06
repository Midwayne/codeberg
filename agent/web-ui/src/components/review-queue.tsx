import { KIND_LABELS, type ReviewDashboard, type ReviewSummary } from '../lib/training';

import { type TrainingReviewView } from './training-review';

export type ReviewQueueProps = { state: Parameters<typeof TrainingReviewView>[0] & { dashboard: ReviewDashboard } };

export function ReviewQueue({ state }: ReviewQueueProps) {
  return (
    <section
      ref={state.queueRef}
      tabIndex={-1}
      className={`min-h-0 min-w-0 flex-col rounded-xl border border-border bg-card ${state.mobileDetails ? 'hidden lg:flex' : 'flex'}`}
      aria-label="Examples"
    >
      <div className="border-b border-border p-3">
        <ReviewFilters state={state} />
      </div>
      <div className="max-h-[45rem] min-h-0 flex-1 overflow-y-auto p-2">
        {state.visible.length ? (
          state.visible.map((row) => <ReviewQueueItem key={row.id} row={row} state={state} />)
        ) : (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            {state.filter === 'ready'
              ? 'All caught up. New examples appear after answered or graded chats.'
              : 'Nothing here yet.'}
          </p>
        )}
      </div>
    </section>
  );
}

export type ReviewFiltersProps = Pick<Parameters<typeof ReviewQueue>[0], 'state'>;

export function ReviewFilters({ state }: ReviewFiltersProps) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1 text-xs" aria-label="Example filters">
      {(
        [
          ['ready', `To review · ${state.dashboard.stats.ready}`],
          [
            'reviewed',
            `Reviewed · ${state.dashboard.stats.training + state.dashboard.stats.eval + state.dashboard.stats.dismissed}`,
          ],
          ['stale', `Outdated · ${state.dashboard.stats.stale}`],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          disabled={state.locked}
          onClick={() => {
            state.review.setFilter(key);
            state.setValidationError('');
          }}
          aria-pressed={state.filter === key}
          className={`min-h-11 rounded-md px-1 py-2 font-medium transition-colors disabled:opacity-50 ${state.filter === key ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export type ReviewQueueItemProps = Pick<Parameters<typeof ReviewQueue>[0], 'state'> & { row: ReviewSummary };

export function ReviewQueueItem({ row, state }: ReviewQueueItemProps) {
  return (
    <button
      key={row.id}
      type="button"
      disabled={state.locked}
      onClick={() => state.select(row.id)}
      aria-controls="training-example"
      aria-pressed={state.selectedId === row.id}
      className={`mb-1 w-full rounded-lg border px-3 py-3 text-left transition-colors disabled:opacity-50 ${state.selectedId === row.id ? 'border-primary/40 bg-accent' : 'border-transparent hover:bg-muted'}`}
    >
      <span className="block break-words text-xs leading-5 text-muted-foreground">
        {KIND_LABELS[row.kind]} · {row.repositories.join(', ') || 'No repository'}
      </span>
      <span className="mt-1 block line-clamp-2 break-words text-sm font-medium">{row.query}</span>
      <span className="mt-1 block text-xs text-muted-foreground">
        {row.state === 'ready'
          ? 'Ready for review'
          : row.state === 'stale'
            ? 'Outdated revision'
            : row.state === 'eval'
              ? 'Evaluation'
              : row.state === 'training'
                ? 'Training'
                : 'Set aside'}
      </span>
    </button>
  );
}
