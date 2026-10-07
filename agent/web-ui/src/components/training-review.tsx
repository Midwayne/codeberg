import { LoadingBoundary, LoadingStatus } from './loading';
import { ReviewSelection } from './review-selection';
import { ReviewQueue } from './review-queue';
import { TrainingSummary } from './training-summary';
import { useReviewScreen } from '../lib/use-review-screen';
import { RefreshCw } from 'lucide-react';

import { type ReviewExample, type ReviewSummary } from '../lib/training';
import { type ReviewDecision } from '../lib/training-review';

import { ErrorNotice, IconButton } from './ui';

export type Decision = ReviewDecision;

export function TrainingReview() {
  const state = useReviewScreen();

  return <TrainingReviewView {...state} />;
}

export type TrainingReviewViewProps = ReturnType<typeof useReviewScreen>;

export function TrainingReviewView(state: TrainingReviewViewProps) {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background" aria-label="Training review">
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:py-9">
        {state.settingsError && (
          <ErrorNotice
            title="Could not load learning permissions"
            detail={state.settingsError}
            onRetry={() => state.setRetrySettings((value) => value + 1)}
          />
        )}
        <ReviewHeader state={state} />

        <LoadingStatus active={state.review.loading && Boolean(state.dashboard)} label="Refreshing training data…" />
        {state.review.dashboardError && (
          <ErrorNotice
            title={state.dashboard ? 'Could not refresh training data' : 'Could not load training data'}
            detail={state.review.dashboardError}
            onRetry={state.review.refresh}
          />
        )}
        {state.review.announcement && (
          <p role="status" className="text-sm text-foreground">
            {state.review.announcement}
          </p>
        )}

        <ReviewContent state={state} />
      </div>
    </main>
  );
}

function ReviewContent({ state }: { state: TrainingReviewViewProps }) {
  return (
    <LoadingBoundary loading={!state.dashboard && !state.review.dashboardError} label="Loading training data…" kind="detail">
      {state.dashboard && <div className="space-y-6">
        <TrainingSummary stats={state.dashboard.stats} />
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(16rem,21rem)_minmax(0,1fr)]">
          <ReviewQueue state={{ ...state, dashboard: state.dashboard }} />
          <ReviewSelection state={state} />
        </div>
      </div>}
    </LoadingBoundary>
  );
}

export type SelectedReviewDetailProps = {
  state: ReturnType<typeof useReviewScreen> & { selected: ReviewSummary; example: ReviewExample };
};

export type ReviewHeaderProps = { state: Parameters<typeof TrainingReviewView>[0] };

function ReviewHeader({ state }: ReviewHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h1 ref={state.titleRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight">
          Training review
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Check an example, then decide whether it belongs in training or a held-out evaluation set. Approval saves data
          for later use; it does not retrain the current model.
        </p>
      </div>
      <IconButton
        onClick={state.review.refresh}
        disabled={state.locked}
        aria-label="Refresh training data"
        title="Refresh training data"
      >
        <RefreshCw className="size-4" />
      </IconButton>
    </div>
  );
}

export { TrainingSummary } from './training-summary';

export { ReviewDetail } from './review-detail';
