import { useRef, useState } from 'react';
import { type DreamingDashboard, type DreamingReport } from './dreaming';
import { useProjectApi } from './project-api';

import { useDreamingSelection } from './use-dreaming-selection';
import { createDreamingDecision } from './dreaming-decision';

export type DreamingPanelOptions = { enabled: boolean };

export function useDreamingPanel({ enabled }: DreamingPanelOptions) {
  const { fetch: api } = useProjectApi();
  const [dashboard, setDashboard] = useState<DreamingDashboard>();
  const [report, setReport] = useState<DreamingReport>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const active = useRef(true);
  const writing = useRef(false);
  const { pending, act, select } = useDreamingActions({
    active,
    setDashboard,
    setReport,
    setError,
    api,
    retry,
    enabled,
    dashboard,
    writing,
    setBusy,
    setNotice,
    report,
  });

  return { busy, setRetry, enabled, dashboard, pending, act, report, error, notice, select };
}

export type DreamingActionsOptions = Pick<Parameters<typeof useDreamingPanel>[0], 'enabled'> & {
  active: React.RefObject<boolean>;
  setDashboard: React.Dispatch<React.SetStateAction<DreamingDashboard | undefined>>;
  setReport: React.Dispatch<React.SetStateAction<DreamingReport | undefined>>;
  setError: React.Dispatch<React.SetStateAction<string>>;
  api: typeof fetch;
  retry: number;
  dashboard: DreamingDashboard | undefined;
  writing: React.RefObject<boolean>;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setNotice: React.Dispatch<React.SetStateAction<string>>;
  report: DreamingReport | undefined;
};

export function useDreamingActions(state: DreamingActionsOptions) {
  const { pending, select } = useDreamingSelection({
    active: state.active,
    setDashboard: state.setDashboard,
    setReport: state.setReport,
    setError: state.setError,
    api: state.api,
    retry: state.retry,
    enabled: state.enabled,
    dashboard: state.dashboard,
  });
  const { act } = createDreamingDecision({ state });

  return { pending, act, select };
}
