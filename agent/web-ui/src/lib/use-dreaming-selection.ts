import { useEffect, useRef, useState } from 'react';

import { dreamingRequest, type DreamingDashboard, type DreamingReport } from './dreaming';

type DreamingSelectionOptions = { api: typeof fetch; retry: number; enabled: boolean };

export type DreamingSelection = ReturnType<typeof useDreamingSelection>;

/** Loads the dashboard and the selected report; a newer selection always wins over a slower one. */
export function useDreamingSelection({ api, retry, enabled }: DreamingSelectionOptions) {
  const [dashboard, setDashboard] = useState<DreamingDashboard>();
  const [report, setReport] = useState<DreamingReport>();
  const [error, setError] = useState('');
  const active = useRef(true);
  const selection = useRef(0);

  useEffect(() => {
    active.current = true;
    let current = true;
    setDashboard(undefined);
    setReport(undefined);
    setError('');
    selection.current++;

    void dreamingRequest<DreamingDashboard>(api)
      .then((value) => {
        if (current) setDashboard(value);
      })
      .catch((reason: unknown) => {
        if (current) setError(String(reason));
      });

    return () => {
      current = false;
      active.current = false;
      selection.current++;
    };
  }, [api, retry]);

  const pending = enabled && dashboard?.jobs.some((job) => job.status === 'pending' || job.status === 'processing');
  useDreamingPolling({ pending, api, onDashboard: setDashboard, onError: setError });

  const select = async (id: string) => {
    const revision = ++selection.current;
    setError('');

    try {
      const value = await dreamingRequest<DreamingReport>(api, `/${id}`);
      if (active.current && selection.current === revision) setReport(value);
    } catch (reason) {
      if (active.current && selection.current === revision) setError(String(reason));
    }
  };

  return { dashboard, setDashboard, report, setReport, error, setError, active, pending, select };
}

type DreamingPollingOptions = {
  pending: boolean | undefined;
  api: typeof fetch;
  onDashboard: (dashboard: DreamingDashboard) => void;
  onError: (message: string) => void;
};

/** Refreshes the dashboard every five seconds while a report is being produced. */
function useDreamingPolling({ pending, api, onDashboard, onError }: DreamingPollingOptions) {
  useEffect(() => {
    if (!pending) return;

    let current = true;
    const timer = setInterval(() => {
      void dreamingRequest<DreamingDashboard>(api)
        .then((value) => {
          if (current) onDashboard(value);
        })
        .catch((reason: unknown) => {
          if (current) onError(String(reason));
        });
    }, 5_000);

    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [api, pending]);
}
