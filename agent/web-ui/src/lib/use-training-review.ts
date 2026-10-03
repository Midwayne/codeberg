import { useProjectApi } from '@/lib/project-api';
import { useEffect, useRef, useState } from 'react';

import { loadReviewExample, loadTrainingReview, submitReview, type ReviewDashboard, type ReviewExample } from './training';
import { applyReviewDecision, reviewRows, reviewSelection, type ReviewDecision, type ReviewFilter } from './training-review';

/** Separate read failures from write results; stale reads never replace a newer selection. */
export function useTrainingReview() {
  const { fetch: api } = useProjectApi();
  const [dashboard, setDashboard] = useState<ReviewDashboard>();
  const [filter, setFilter] = useState<ReviewFilter>('ready');
  const [requestedId, setRequestedId] = useState<string>();
  const [example, setExample] = useState<ReviewExample>();
  const [dashboardAttempt, setDashboardAttempt] = useState(0);
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mounted = useRef(false);
  const visible = reviewRows(dashboard?.candidates ?? [], filter);
  const selectedId = reviewSelection(visible, filter, requestedId);
  const selected = visible.find((row) => row.id === selectedId);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setDashboardError('');
    void loadTrainingReview(controller.signal, api).then((next) => {
      if (!controller.signal.aborted) setDashboard(next);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setDashboardError(String(error));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [dashboardAttempt, api]);

  useEffect(() => {
    const controller = new AbortController();
    setExample(undefined);
    setDetailError('');
    setSaveError('');
    if (selectedId) void loadReviewExample(selectedId, controller.signal, api).then((next) => {
      if (!controller.signal.aborted) setExample(next);
    }).catch((error: unknown) => { if (!controller.signal.aborted) setDetailError(String(error)); });
    return () => controller.abort();
  }, [selectedId, detailAttempt, api]);

  async function save(decision: ReviewDecision, oracle?: Record<string, unknown>): Promise<void> {
    if (!selected || selected.state !== 'ready' || !selected.eligible || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    setAnnouncement('');
    try {
      await submitReview(selected.id, decision, oracle, api);
      if (!mounted.current) return;
      setDashboard((current) => current ? applyReviewDecision(current, selected.id, decision) : current);
      setAnnouncement(decision === 'dismiss' ? 'Example set aside.' : decision === 'eval' ? 'Evaluation case saved.' : 'Example added to training.');
      setFilter('ready');
      setRequestedId(undefined);
      setDashboardAttempt((attempt) => attempt + 1);
    } catch (error) {
      if (mounted.current) setSaveError(`Could not save this decision. ${String(error)}`);
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return {
    dashboard, filter, setFilter, visible, selected, selectedId, example,
    select: setRequestedId, loading, dashboardError, detailError, saveError, announcement, saving, save,
    refresh: () => setDashboardAttempt((attempt) => attempt + 1),
    retryDetail: () => setDetailAttempt((attempt) => attempt + 1),
  };
}
