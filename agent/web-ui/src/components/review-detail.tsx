import { useEffect, useId, useRef } from 'react';
import { KIND_LABELS, exampleAnswer, type ReviewExample, type ReviewSummary } from '../lib/training';

import { type Decision } from './training-review';
import { collectReviewEvidence } from '../lib/review-evidence';
import { ReviewDecisionForm } from './review-decision';

export type ReviewDetailProps = {
  trainingEnabled?: boolean;
  evalEnabled?: boolean;
  row: ReviewSummary;
  example: ReviewExample;
  destination: 'training' | 'eval';
  onDestination: (value: 'training' | 'eval') => void;
  verified: string[];
  onVerified: (path: string) => void;
  otherPaths: string;
  onOtherPaths: (value: string) => void;
  expected: string;
  onExpected: (value: string) => void;
  saving: boolean;
  error?: string;
  canNext?: boolean;
  onDecide: (decision: Decision) => void;
  onNext: () => void;
};

export function ReviewDetail(props: ReviewDetailProps) {
  const state = useReviewDetail(props);

  return <ReviewDetailView {...state} />;
}

export type ReviewDetailOptions = {
  trainingEnabled?: boolean;
  evalEnabled?: boolean;
  row: ReviewSummary;
  example: ReviewExample;
  destination: 'training' | 'eval';
  onDestination: (value: 'training' | 'eval') => void;
  verified: string[];
  onVerified: (path: string) => void;
  otherPaths: string;
  onOtherPaths: (value: string) => void;
  expected: string;
  onExpected: (value: string) => void;
  saving: boolean;
  error?: string;
  canNext?: boolean;
  onDecide: (decision: Decision) => void;
  onNext: () => void;
};

export function useReviewDetail(state: ReviewDetailOptions) {
  const { canNext = true, trainingEnabled = true, evalEnabled = true } = state;

  const answer = exampleAnswer(state.example);
  const { allEvidence, choices } = collectReviewEvidence({
    example: state.example,
    destination: state.destination,
    row: state.row,
  });

  const feedback = state.example.feedback.at(-1);
  const { errorId, errorRef } = useReviewError({ error: state.error });

  return {
    row: state.row,
    answer,
    example: state.example,
    feedback,
    allEvidence,
    saving: state.saving,
    error: state.error,
    errorId,
    trainingEnabled,
    onDestination: state.onDestination,
    destination: state.destination,
    evalEnabled,
    choices,
    verified: state.verified,
    onVerified: state.onVerified,
    otherPaths: state.otherPaths,
    onOtherPaths: state.onOtherPaths,
    expected: state.expected,
    onExpected: state.onExpected,
    errorRef,
    onDecide: state.onDecide,
    canNext,
    onNext: state.onNext,
  };
}

export type ReviewDetailViewProps = ReturnType<typeof useReviewDetail>;

export function ReviewDetailView(state: ReviewDetailViewProps) {
  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="rounded-full bg-muted px-2.5 py-1 font-medium text-foreground">
          {KIND_LABELS[state.row.kind]}
        </span>
        <span>
          {state.row.repositories.join(', ') || 'No repository'} ·{' '}
          {new Date(state.row.extracted_at).toLocaleDateString()}
        </span>
      </div>
      <div>
        <h2 className="text-lg font-semibold leading-snug break-words">{state.row.query}</h2>
      </div>
      <ReviewAnswer state={state} />
      {typeof state.example.payload.rejected === 'string' && (
        <div>
          <h3 className="text-sm font-medium">Earlier answer that was rejected</h3>
          <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-border bg-muted/50 p-3 text-sm whitespace-pre-wrap wrap-break-word">
            {state.example.payload.rejected}
          </div>
        </div>
      )}
      {state.feedback && (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <span className="font-medium">User feedback: {state.feedback.label.replaceAll('_', ' ')}</span>
          {state.feedback.reason && <p className="mt-1 break-words text-muted-foreground">{state.feedback.reason}</p>}
        </div>
      )}
      <ReviewEvidence state={state} />

      <ReviewDecisionForm state={state} />
      <details className="border-t border-border pt-4 text-xs text-muted-foreground">
        <summary className="min-h-11 cursor-pointer py-3">Technical record</summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-muted p-3 whitespace-pre-wrap wrap-break-word">
          {JSON.stringify(state.example.payload, null, 2)}
        </pre>
      </details>
    </div>
  );
}

export type ReviewEvidenceProps = { state: Parameters<typeof ReviewDetailView>[0] };

export function ReviewEvidence({ state }: ReviewEvidenceProps) {
  return (
    state.allEvidence.size > 0 && (
      <div>
        <h3 className="text-sm font-medium">Evidence to check</h3>
        <div className="mt-2 space-y-2">
          {[...state.allEvidence.values()].map((hit, index) => (
            <div key={`${hit.path}-${index}`} className="rounded-lg border border-border p-3 text-xs">
              <span className="font-mono wrap-break-word">{hit.path}</span>
              {hit.snippet && (
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-muted-foreground">{hit.snippet}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    )
  );
}

export type ReviewAnswerProps = { state: Parameters<typeof ReviewDetailView>[0] };

export function ReviewAnswer({ state }: ReviewAnswerProps) {
  return (
    state.answer && (
      <div>
        <h3 className="text-sm font-medium">Answer to review</h3>
        <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-border bg-background p-3 text-sm whitespace-pre-wrap wrap-break-word">
          {state.answer}
        </div>
      </div>
    )
  );
}

export type ReviewErrorOptions = Pick<Parameters<typeof useReviewDetail>[0], 'error'>;

function useReviewError({ error }: ReviewErrorOptions) {
  const errorId = useId();

  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  return { errorId, errorRef };
}
