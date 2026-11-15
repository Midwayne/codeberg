import { useState } from 'react';

import { useProjectApi } from './project-api';
import { useDreamingDecision } from './use-dreaming-decision';
import { useDreamingSelection } from './use-dreaming-selection';

export type DreamingPanelOptions = { enabled: boolean };

export function useDreamingPanel({ enabled }: DreamingPanelOptions) {
  const { fetch: api } = useProjectApi();
  const [retry, setRetry] = useState(0);
  const selection = useDreamingSelection({ api, retry, enabled });
  const { busy, notice, act } = useDreamingDecision(api, selection);
  const { dashboard, pending, report, error, select } = selection;

  return { busy, setRetry, enabled, dashboard, pending, act, report, error, notice, select };
}
