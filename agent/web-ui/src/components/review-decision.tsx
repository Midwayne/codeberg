import { type ReviewDetailView } from './review-detail';

import { ArrowRight, Check, CircleHelp, ShieldCheck, Sparkles } from 'lucide-react';

import { VerifiedSources } from './review-verified-sources';

export type ReviewDecisionFormProps = { state: Parameters<typeof ReviewDetailView>[0] };

export function ReviewDecisionForm({ state }: ReviewDecisionFormProps) {
  return state.row.state === 'ready' && state.row.eligible ? (
    <fieldset
      disabled={state.saving}
      aria-describedby={state.error ? state.errorId : undefined}
      className="min-w-0 space-y-4 border-t border-border pt-5"
    >
      <legend className="sr-only">Review decision</legend>
      <ReviewDestinations state={state} />
      {(!state.trainingEnabled || !state.evalEnabled) && (
        <p className="text-xs leading-5 text-muted-foreground">
          {!state.trainingEnabled && !state.evalEnabled
            ? 'Training and evaluations are paused.'
            : !state.trainingEnabled
              ? 'Training review is paused.'
              : 'Evaluations are paused.'}{' '}
          Change this in Settings → Learning.
        </p>
      )}
      <ReviewDecisionHelp state={state} />
      <VerifiedSources state={state} />
      {state.error && (
        <p
          id={state.errorId}
          ref={state.errorRef}
          tabIndex={-1}
          role="alert"
          className="break-words text-sm text-destructive"
        >
          {state.error}
        </p>
      )}
      <DecisionActions state={state} />
    </fieldset>
  ) : (
    <p className="flex items-center gap-2 border-t border-border pt-4 text-sm text-muted-foreground">
      <CircleHelp className="size-4 shrink-0" />{' '}
      {state.row.state === 'stale' || !state.row.eligible
        ? 'This example is outdated after newer feedback. It cannot be approved.'
        : state.row.state === 'dismissed'
          ? 'You set this example aside.'
          : `Approved for ${state.row.state === 'eval' ? 'evaluation' : 'training'}.`}
    </p>
  );
}

export type ReviewDestinationsProps = Pick<Parameters<typeof ReviewDecisionForm>[0], 'state'>;

export function ReviewDestinations({ state }: ReviewDestinationsProps) {
  return (
    <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1 text-sm">
      <button
        type="button"
        disabled={!state.trainingEnabled}
        onClick={() => state.onDestination('training')}
        aria-pressed={state.destination === 'training'}
        className={`min-h-11 rounded-md px-3 py-2 font-medium disabled:opacity-50 ${state.destination === 'training' ? 'bg-background' : 'text-muted-foreground'}`}
      >
        Teach the agent
      </button>
      <button
        type="button"
        disabled={!state.evalEnabled}
        onClick={() => state.onDestination('eval')}
        aria-pressed={state.destination === 'eval'}
        className={`min-h-11 rounded-md px-3 py-2 font-medium disabled:opacity-50 ${state.destination === 'eval' ? 'bg-background' : 'text-muted-foreground'}`}
      >
        Test the agent
      </button>
    </div>
  );
}

export type DecisionActionsProps = Pick<Parameters<typeof ReviewDecisionForm>[0], 'state'>;

export function DecisionActions({ state }: DecisionActionsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={state.saving || (state.destination === 'training' ? !state.trainingEnabled : !state.evalEnabled)}
        onClick={() => state.onDecide(state.destination)}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        <Check className="size-4" />{' '}
        {state.saving ? 'Saving…' : state.destination === 'training' ? 'Add to training' : 'Save evaluation case'}
      </button>
      <button
        type="button"
        disabled={state.saving}
        onClick={() => state.onDecide('dismiss')}
        className="min-h-11 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
      >
        Set aside
      </button>
      <button
        type="button"
        disabled={state.saving || !state.canNext}
        onClick={state.onNext}
        className="ml-auto inline-flex min-h-11 items-center gap-1 px-2 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        Next <ArrowRight className="size-4" />
      </button>
    </div>
  );
}

export type ReviewDecisionHelpProps = Pick<Parameters<typeof ReviewDecisionForm>[0], 'state'>;

export function ReviewDecisionHelp({ state }: ReviewDecisionHelpProps) {
  return (
    <p className="flex items-start gap-2 text-xs text-muted-foreground">
      {state.destination === 'training' ? (
        <Sparkles className="mt-0.5 size-4 shrink-0" />
      ) : (
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
      )}
      {state.destination === 'training'
        ? 'Training teaches future answers. Approve only if the answer and evidence look right.'
        : 'Evaluation is held out to measure quality. Check the expected outcome independently before saving it.'}
    </p>
  );
}
