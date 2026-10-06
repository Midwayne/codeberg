import { submitReview, type ReviewDashboard, type ReviewSummary } from './training';
import { applyReviewDecision, type ReviewDecision, type ReviewFilter } from './training-review';

export type ReviewSaveOptions = {
  selected: ReviewSummary | undefined;
  savingRef: React.RefObject<boolean>;
  setSaving: React.Dispatch<React.SetStateAction<boolean>>;
  setSaveError: React.Dispatch<React.SetStateAction<string>>;
  setAnnouncement: React.Dispatch<React.SetStateAction<string>>;
  api: typeof fetch;
  mounted: React.RefObject<boolean>;
  setDashboard: React.Dispatch<React.SetStateAction<ReviewDashboard | undefined>>;
  setFilter: React.Dispatch<React.SetStateAction<ReviewFilter>>;
  setRequestedId: React.Dispatch<React.SetStateAction<string | undefined>>;
  setDashboardAttempt: React.Dispatch<React.SetStateAction<number>>;
};

export function useReviewSave({
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
}: ReviewSaveOptions) {
  async function save(decision: ReviewDecision, oracle?: Record<string, unknown>): Promise<void> {
    if (!selected || selected.state !== 'ready' || !selected.eligible || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    setAnnouncement('');
    try {
      await submitReview(selected.id, decision, oracle, api);
      if (!mounted.current) return;
      setDashboard((current) => (current ? applyReviewDecision(current, selected.id, decision) : current));
      setAnnouncement(
        decision === 'dismiss'
          ? 'Example set aside.'
          : decision === 'eval'
            ? 'Evaluation case saved.'
            : 'Example added to training.',
      );
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

  return { save };
}
