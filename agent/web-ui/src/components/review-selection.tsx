import { ArrowLeft } from 'lucide-react';

import { ErrorNotice } from './ui';
import { type TrainingReviewView, type SelectedReviewDetailProps } from './training-review';
import { ReviewDetail } from './review-detail';

export type ReviewSelectionProps = { state: Parameters<typeof TrainingReviewView>[0] };

export function ReviewSelection({ state }: ReviewSelectionProps) {
  return (
    <section
      id="training-example"
      ref={state.detailRef}
      tabIndex={-1}
      aria-busy={!!state.selected && !state.example && !state.review.detailError}
      className={`min-w-0 scroll-mt-4 rounded-xl border border-border bg-card ${state.mobileDetails ? 'block' : 'hidden lg:block'}`}
      aria-label="Example details"
    >
      <div className="border-b border-border p-2 lg:hidden">
        <button
          type="button"
          disabled={state.saving}
          onClick={state.backToExamples}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm hover:bg-accent disabled:opacity-50"
        >
          <ArrowLeft className="size-4" />
          Back to examples
        </button>
      </div>
      {state.review.detailError ? (
        <div className="p-4">
          <ErrorNotice
            title="Could not load this example"
            detail={state.review.detailError}
            onRetry={state.review.retryDetail}
          />
        </div>
      ) : state.selected && state.example?.id === state.selected.id ? (
        <SelectedReviewDetail state={{ ...state, selected: state.selected, example: state.example }} />
      ) : (
        <div
          role={state.selected ? 'status' : undefined}
          className="flex min-h-64 items-center justify-center px-6 text-center text-sm text-muted-foreground"
        >
          {state.selected ? 'Loading example…' : 'Select an example to inspect its answer and evidence.'}
        </div>
      )}
    </section>
  );
}

export function SelectedReviewDetail({ state }: SelectedReviewDetailProps) {
  return (
    <ReviewDetail
      trainingEnabled={state.trainingEnabled}
      evalEnabled={state.evalEnabled}
      row={state.selected}
      example={state.example}
      destination={state.destination}
      onDestination={(value) => {
        state.setDestination(value);
        state.setVerified([]);
        state.setValidationError('');
      }}
      verified={state.verified}
      onVerified={(path) => {
        state.setVerified((current) =>
          current.includes(path) ? current.filter((item) => item !== path) : [...current, path],
        );
        state.setValidationError('');
      }}
      otherPaths={state.otherPaths}
      onOtherPaths={state.setOtherPaths}
      expected={state.expected}
      onExpected={state.setExpected}
      saving={state.locked}
      error={state.validationError || state.review.saveError}
      canNext={state.visible.length > 1}
      onDecide={state.decide}
      onNext={state.nextExample}
    />
  );
}
