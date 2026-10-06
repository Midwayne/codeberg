import { type useDreamingActions } from './use-dreaming-panel';

import { dreamingRequest, type DreamingDashboard, type DreamingDecision, type DreamingReport } from './dreaming';

export type DreamingDecisionOptions = { state: Parameters<typeof useDreamingActions>[0] };

export function createDreamingDecision({ state }: DreamingDecisionOptions) {
  const act = async (action?: DreamingDecision) => {
    if (state.writing.current) return;
    state.writing.current = true;
    state.setBusy(true);
    state.setError('');
    state.setNotice('');
    try {
      const value = await dreamingRequest<DreamingReport>(
        state.api,
        action && state.report ? `/${state.report.id}` : '',
        action ? { action } : {},
      );
      if (!state.active.current) return;
      if (action) state.setReport(value);
      state.setNotice(
        action === 'apply'
          ? 'Applied. New chat turns use the consolidated knowledge.'
          : action === 'undo'
            ? 'Undone. Original knowledge is available again.'
            : action === 'dismiss'
              ? 'Report dismissed.'
              : 'Report queued. You can keep chatting while it runs.',
      );
      // The decision is confirmed before refreshing, so a failed refresh does not erase success.
      const fresh = await dreamingRequest<DreamingDashboard>(state.api);
      if (state.active.current) state.setDashboard(fresh);
    } catch (reason) {
      if (state.active.current) state.setError(String(reason));
    } finally {
      state.writing.current = false;
      if (state.active.current) state.setBusy(false);
    }
  };

  return { act };
}
