import { useEffect, useRef, useState } from 'react';
import { proposedEvidence, type ReviewExample, type ReviewSummary } from './training';
import { prepareReviewDecision } from './training-review';
import { useProjectApi } from './project-api';
import { loadLearningSettings, type LearningSettings } from './learning-settings';
import { useTrainingReview } from './use-training-review';
import { useMediaQuery } from './use-media-query';

import { type Decision } from '../components/training-review';

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

export function useReviewPermissions() {
  const { fetch: api } = useProjectApi();
  const [settings, setSettings] = useState<LearningSettings | null>();
  const [settingsError, setSettingsError] = useState('');
  const [retrySettings, setRetrySettings] = useState(0);
  useEffect(() => {
    let active = true;
    setSettingsError('');
    void loadLearningSettings(api)
      .then((value) => {
        if (active) setSettings(value);
      })
      .catch((reason: unknown) => {
        if (active) setSettingsError(String(reason));
      });
    return () => {
      active = false;
    };
  }, [api, retrySettings]);
  const trainingEnabled = Boolean(settings?.enabled && settings.datasets && settings.training);
  const evalEnabled = Boolean(settings?.enabled && settings.datasets && settings.evals);

  return { trainingEnabled, evalEnabled, settingsError, setRetrySettings };
}

export type ReviewNavigationOptions = { selectedId: string | undefined };

export function useReviewNavigation({ selectedId }: ReviewNavigationOptions) {
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

export type ReviewDecisionOptions = {
  trainingEnabled: boolean;
  evalEnabled: boolean;
  selectedId: string | undefined;
  selected: ReviewSummary | undefined;
  example: ReviewExample | undefined;
  locked: boolean;
  review: ReturnType<typeof useTrainingReview>;
};

export function useReviewDecision(state: ReviewDecisionOptions) {
  const [destination, setDestination] = useState<'training' | 'eval'>('training');

  const [verified, setVerified] = useState<string[]>([]);

  const [otherPaths, setOtherPaths] = useState('');

  const [expected, setExpected] = useState('');

  const [validationError, setValidationError] = useState('');

  useEffect(() => {
    setVerified([]);
    setOtherPaths('');
    setExpected('');
    setDestination(state.trainingEnabled || !state.evalEnabled ? 'training' : 'eval');
    setValidationError('');
  }, [state.selectedId, state.trainingEnabled, state.evalEnabled]);

  function decide(decision: Decision): void {
    if (!state.selected || state.example?.id !== state.selected.id || state.locked) return;
    const result = prepareReviewDecision(
      state.selected,
      decision,
      { verified, otherPaths, expected },
      proposedEvidence(state.example, 'proposed_negatives').map((hit) => hit.path),
    );
    setValidationError(result.ok ? '' : result.error);
    if (result.ok) void state.review.save(decision, result.oracle);
  }

  return {
    setValidationError,
    destination,
    setDestination,
    setVerified,
    verified,
    otherPaths,
    setOtherPaths,
    expected,
    setExpected,
    validationError,
    decide,
  };
}
