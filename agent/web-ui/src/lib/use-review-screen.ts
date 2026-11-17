import { useEffect, useRef, useState } from 'react';
import { proposedEvidence, type ReviewExample, type ReviewSummary } from './training';
import { prepareReviewDecision } from './training-review';
import { useProjectApi } from './project-api';
import { useLoadedLearningSettings } from './use-learning-settings';
import { useTrainingReview } from './use-training-review';
import { useMediaQuery } from './use-media-query';

import type { Decision } from '../components/training-review';

export function useReviewScreen() {
  const review = useTrainingReview();
  const permissions = useReviewPermissions();
  const { dashboard, filter, visible, selected, selectedId, example, saving } = review;
  const locked = saving || review.loading;
  const decision = useReviewDecision({ ...permissions, selectedId, selected, example, locked, review });
  const navigation = useReviewNavigation({ selectedId });

  function select(id: string): void {
    if (locked) return;
    review.select(id);
    navigation.setMobileDetails(true);
  }

  function nextExample(): void {
    const index = visible.findIndex((row) => row.id === selectedId);
    const next = visible[(index + 1) % visible.length];
    if (next) select(next.id);
  }

  return {
    ...permissions,
    ...decision,
    ...navigation,
    review,
    locked,
    dashboard,
    filter,
    visible,
    selected,
    selectedId,
    example,
    saving,
    select,
    nextExample,
  };
}

function useReviewPermissions() {
  const { fetch: api } = useProjectApi();
  const { settings, error: settingsError, setRetry: setRetrySettings } = useLoadedLearningSettings(api);

  const trainingEnabled = Boolean(settings?.enabled && settings.datasets && settings.training);
  const evalEnabled = Boolean(settings?.enabled && settings.datasets && settings.evals);

  return { trainingEnabled, evalEnabled, settingsError, setRetrySettings };
}

type ReviewNavigationOptions = { selectedId: string | undefined };

function useReviewNavigation({ selectedId }: ReviewNavigationOptions) {
  const [mobileDetails, setMobileDetails] = useState(false);

  const desktop = useMediaQuery('(min-width: 1024px)');

  const titleRef = useRef<HTMLHeadingElement>(null);

  const queueRef = useRef<HTMLElement>(null);

  const detailRef = useRef<HTMLElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!mobileDetails || desktop) return;
    detailRef.current?.focus();
    detailRef.current?.scrollIntoView({ block: 'start' });
  }, [mobileDetails, selectedId, desktop]);

  function backToExamples(): void {
    setMobileDetails(false);
    requestAnimationFrame(() => {
      queueRef.current?.focus();
      queueRef.current?.scrollIntoView({ block: 'start' });
    });
  }

  return { setMobileDetails, titleRef, queueRef, mobileDetails, detailRef, backToExamples };
}

type ReviewDecisionOptions = {
  trainingEnabled: boolean;
  evalEnabled: boolean;
  selectedId: string | undefined;
  selected: ReviewSummary | undefined;
  example: ReviewExample | undefined;
  locked: boolean;
  review: ReturnType<typeof useTrainingReview>;
};

function useReviewDecision(state: ReviewDecisionOptions) {
  const form = useDecisionForm(state);

  function decide(decision: Decision): void {
    if (!state.selected || state.example?.id !== state.selected.id || state.locked) return;

    const result = prepareReviewDecision(
      state.selected,
      decision,
      { verified: form.verified, otherPaths: form.otherPaths, expected: form.expected },
      proposedEvidence(state.example, 'proposed_negatives').map((hit) => hit.path),
    );
    form.setValidationError(result.ok ? '' : result.error);
    if (result.ok) void state.review.save(decision, result.oracle);
  }

  return { ...form, decide };
}

function defaultDestination({ trainingEnabled, evalEnabled }: ReviewDecisionOptions): 'training' | 'eval' {
  return trainingEnabled || !evalEnabled ? 'training' : 'eval';
}

/** Form fields that start over for each selected example or permission change. */
function useDecisionForm(state: ReviewDecisionOptions) {
  const [destination, setDestination] = useState(() => defaultDestination(state));
  const [verified, setVerified] = useState<string[]>([]);
  const [otherPaths, setOtherPaths] = useState('');
  const [expected, setExpected] = useState('');
  const [validationError, setValidationError] = useState('');

  // Reset while rendering, so a newly selected example never shows the previous one's input.
  const resetKey = `${state.selectedId}|${state.trainingEnabled}|${state.evalEnabled}`;
  const [formKey, setFormKey] = useState(resetKey);
  if (formKey !== resetKey) {
    setFormKey(resetKey);
    setVerified([]);
    setOtherPaths('');
    setExpected('');
    setDestination(defaultDestination(state));
    setValidationError('');
  }

  return {
    destination,
    setDestination,
    verified,
    setVerified,
    otherPaths,
    setOtherPaths,
    expected,
    setExpected,
    validationError,
    setValidationError,
  };
}
