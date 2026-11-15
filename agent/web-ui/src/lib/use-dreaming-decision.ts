import { useRef, useState } from 'react';

import { dreamingRequest, type DreamingDashboard, type DreamingDecision, type DreamingReport } from './dreaming';
import type { DreamingSelection } from './use-dreaming-selection';

const NOTICES: Record<DreamingDecision | 'queue', string> = {
  apply: 'Applied. New chat turns use the consolidated knowledge.',
  undo: 'Undone. Original knowledge is available again.',
  dismiss: 'Report dismissed.',
  queue: 'Report queued. You can keep chatting while it runs.',
};

/** Queues a report (no action) or decides the selected one, one write at a time. */
export function useDreamingDecision(api: typeof fetch, selection: DreamingSelection) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const writing = useRef(false);
  const { active, report, setReport, setDashboard, setError } = selection;

  const act = async (action?: DreamingDecision) => {
    if (writing.current) return;

    writing.current = true;
    setBusy(true);
    setError('');
    setNotice('');

    try {
      const path = action && report ? `/${report.id}` : '';
      const value = await dreamingRequest<DreamingReport>(api, path, action ? { action } : {});
      if (!active.current) return;

      if (action) setReport(value);
      setNotice(NOTICES[action ?? 'queue']);

      // The decision is confirmed before refreshing, so a failed refresh does not erase success.
      const fresh = await dreamingRequest<DreamingDashboard>(api);
      if (active.current) setDashboard(fresh);
    } catch (reason) {
      if (active.current) setError(String(reason));
    } finally {
      writing.current = false;
      if (active.current) setBusy(false);
    }
  };

  return { busy, notice, act };
}
