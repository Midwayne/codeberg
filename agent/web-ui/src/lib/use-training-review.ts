import { useReviewSave } from './use-review-save';
import { useProjectApi } from './project-api';
import { useEffect, useState } from 'react';

import { loadReviewExample, loadTrainingReview, type ReviewDashboard, type ReviewExample } from './training';
import { applyReviewDecision, reviewRows, reviewSelection, type ReviewFilter } from './training-review';

/** Separate read failures from write results; stale reads never replace a newer selection. */
export function useTrainingReview() {
  const { fetch: api } = useProjectApi();
  const { dashboard, setDashboard, setDashboardAttempt, loading, dashboardError } = useReviewDashboard({ api });
  const { selectedId, selected, setFilter, setRequestedId, filter, visible } = useReviewSelection({ dashboard });

  const { save, saving, saveError, setSaveError, announcement } = useReviewSave({
    selected,
    api,
    onSaved: (id, decision) => {
      setDashboard((current) => (current ? applyReviewDecision(current, id, decision) : current));
      setFilter('ready');
      setRequestedId(undefined);
      setDashboardAttempt((attempt) => attempt + 1);
    },
  });

  const { example, detailError, setDetailAttempt } = useReviewExample({ setSaveError, selectedId, api });

  return {
    dashboard,
    filter,
    setFilter,
    visible,
    selected,
    selectedId,
    example,
    select: setRequestedId,
    loading,
    dashboardError,
    detailError,
    saveError,
    announcement,
    saving,
    save,
    refresh: () => setDashboardAttempt((attempt) => attempt + 1),
    retryDetail: () => setDetailAttempt((attempt) => attempt + 1),
  };
}

export type ReviewDashboardOptions = {
  api: typeof fetch;
};

function useReviewDashboard({ api }: ReviewDashboardOptions) {
  const [dashboard, setDashboard] = useState<ReviewDashboard>();

  const [dashboardAttempt, setDashboardAttempt] = useState(0);

  const [loading, setLoading] = useState(true);

  const [dashboardError, setDashboardError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setDashboardError('');
    void loadTrainingReview(controller.signal, api)
      .then((next) => {
        if (!controller.signal.aborted) setDashboard(next);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setDashboardError(String(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [dashboardAttempt, api]);

  return { dashboard, setDashboard, setDashboardAttempt, loading, dashboardError };
}

export type ReviewExampleOptions = {
  setSaveError: React.Dispatch<React.SetStateAction<string>>;
  selectedId: string | undefined;
  api: typeof fetch;
};

function useReviewExample({ setSaveError, selectedId, api }: ReviewExampleOptions) {
  const [example, setExample] = useState<ReviewExample>();

  const [detailAttempt, setDetailAttempt] = useState(0);

  const [detailError, setDetailError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setExample(undefined);
    setDetailError('');
    setSaveError('');
    if (selectedId)
      void loadReviewExample(selectedId, controller.signal, api)
        .then((next) => {
          if (!controller.signal.aborted) setExample(next);
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setDetailError(String(error));
        });
    return () => controller.abort();
  }, [selectedId, detailAttempt, api]);

  return { example, detailError, setDetailAttempt };
}

export type ReviewSelectionOptions = { dashboard: ReviewDashboard | undefined };

function useReviewSelection({ dashboard }: ReviewSelectionOptions) {
  const [filter, setFilter] = useState<ReviewFilter>('ready');

  const [requestedId, setRequestedId] = useState<string>();

  const visible = reviewRows(dashboard?.candidates ?? [], filter);

  const selectedId = reviewSelection(visible, filter, requestedId);

  const selected = visible.find((row) => row.id === selectedId);

  return { selectedId, selected, setFilter, setRequestedId, filter, visible };
}
