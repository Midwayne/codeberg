import { type useDreamingActions } from './use-dreaming-panel';
import { useEffect, useRef } from 'react';
import { dreamingRequest, type DreamingDashboard, type DreamingReport } from './dreaming';

export type DreamingSelectionOptions = Pick<
  Parameters<typeof useDreamingActions>[0],
  'active' | 'setDashboard' | 'setReport' | 'setError' | 'api' | 'retry' | 'enabled' | 'dashboard'
>;

export function useDreamingSelection(state: DreamingSelectionOptions) {
  const selection = useRef(0);
  useEffect(() => {
    state.active.current = true;
    let current = true;
    state.setDashboard(undefined);
    state.setReport(undefined);
    state.setError('');
    selection.current++;
    void dreamingRequest<DreamingDashboard>(state.api)
      .then((value) => {
        if (current) state.setDashboard(value);
      })
      .catch((reason: unknown) => {
        if (current) state.setError(String(reason));
      });
    return () => {
      current = false;
      state.active.current = false;
      selection.current++;
    };
  }, [state.api, state.retry]);
  const pending =
    state.enabled && state.dashboard?.jobs.some((job) => job.status === 'pending' || job.status === 'processing');
  useDreamingPolling({ pending, state });

  const select = async (id: string) => {
    const revision = ++selection.current;
    state.setError('');
    try {
      const value = await dreamingRequest<DreamingReport>(state.api, `/${id}`);
      if (state.active.current && selection.current === revision) state.setReport(value);
    } catch (reason) {
      if (state.active.current && selection.current === revision) state.setError(String(reason));
    }
  };

  return { pending, select };
}

export type DreamingPollingOptions = {
  pending: boolean | undefined;
  state: Parameters<typeof useDreamingSelection>[0];
};

export function useDreamingPolling({ pending, state }: DreamingPollingOptions) {
  useEffect(() => {
    if (!pending) return;
    let current = true;
    const timer = setInterval(() => {
      void dreamingRequest<DreamingDashboard>(state.api)
        .then((value) => {
          if (current) state.setDashboard(value);
        })
        .catch((reason: unknown) => {
          if (current) state.setError(String(reason));
        });
    }, 5_000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [state.api, pending]);
}
