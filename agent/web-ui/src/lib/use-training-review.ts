import { useReviewSave } from './use-review-save';
import { useProjectApi } from './project-api';
import { useEffect, useRef, useState } from 'react';

import { loadReviewExample, loadTrainingReview, type ReviewDashboard, type ReviewExample } from './training';
import { reviewRows, reviewSelection, type ReviewFilter } from './training-review';

/** Separate read failures from write results; stale reads never replace a newer selection. */
export function useTrainingReview() {
  const { fetch: api } = useProjectApi();
  const { dashboard, setDashboard, setDashboardAttempt, loading, dashboardError } = useReviewDashboard({ api });
  const { selectedId, selected, setFilter, setRequestedId, filter, visible } = useReviewSelection({ dashboard });

  const [saveError, setSaveError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const { mounted } = useReviewMounted();
  const { example, detailError, setDetailAttempt } = useReviewExample({ setSaveError, selectedId, api });
  const { save } = useReviewSave({
    selected,
    savingRef,
    setSaving,
    setSaveError,
    setAnnouncement,
    api,
    mounted,
    setDashboard,
    setFilter,
    setRequestedId,
    setDashboardAttempt,
  });

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

function useReviewMounted() {
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  return { mounted };
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
