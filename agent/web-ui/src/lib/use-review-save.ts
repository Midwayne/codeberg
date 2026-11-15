import { useEffect, useRef, useState } from 'react';

import { submitReview, type ReviewSummary } from './training';
import type { ReviewDecision } from './training-review';

export type ReviewSaveOptions = {
  selected: ReviewSummary | undefined;
  api: typeof fetch;
  /** Runs in the same update as the announcement, only while still mounted. */
  onSaved: (id: string, decision: ReviewDecision) => void;
};

const ANNOUNCEMENTS: Record<ReviewDecision, string> = {
  dismiss: 'Example set aside.',
  eval: 'Evaluation case saved.',
  training: 'Example added to training.',
};

/** Saves one decision at a time and owns the progress and outcome of that write. */
export function useReviewSave({ selected, api, onSaved }: ReviewSaveOptions) {
  const [saveError, setSaveError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mounted = useMounted();

  async function save(decision: ReviewDecision, oracle?: Record<string, unknown>): Promise<void> {
    if (!selected || selected.state !== 'ready' || !selected.eligible || savingRef.current) return;

    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    setAnnouncement('');

    try {
      await submitReview(selected.id, decision, oracle, api);
      if (!mounted.current) return;

      setAnnouncement(ANNOUNCEMENTS[decision]);
      onSaved(selected.id, decision);
    } catch (error) {
      if (mounted.current) setSaveError(`Could not save this decision. ${String(error)}`);
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return { save, saving, saveError, setSaveError, announcement };
}

function useMounted() {
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  return mounted;
}
