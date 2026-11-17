import { useEffect, useState } from 'react';

import type { Project, ProjectStatus } from './project-api';
import { missingProject, requestProjectStatus, transientStatusError } from './project-status-request';
import { errorMessage } from '@agent/core/errors.js';
import { startPoll } from './poll';

export type ProjectStatusOptions = {
  project: Project | undefined;
  api: typeof fetch;
  retry: number;
  refreshCatalog?: React.Dispatch<React.SetStateAction<number>>;
};

export function useProjectStatus({ project, api, retry, refreshCatalog }: ProjectStatusOptions) {
  const [status, setStatus] = useState<{ id: string; value?: ProjectStatus; error?: string }>();

  useEffect(() => {
    if (!project) return;

    let last: ProjectStatus | undefined;
    let failures = 0;

    const poll = startPoll({
      load: (signal) => requestProjectStatus(api, signal),
      done: (value) => {
        last = value;
        failures = 0;
        setStatus({ id: project.id, value });

        return value.ready && !value.indexing ? 10000 : 2000;
      },
      fail: (reason) => {
        if (missingProject(reason)) refreshCatalog?.((value) => value + 1);

        failures++;
        const transient = transientStatusError(reason);
        if (!transient || failures > 1) setStatus({ id: project.id, value: last,
          error: transient ? 'Could not check project status. Retrying automatically. Last reported progress may be out of date.'
            : errorMessage(reason) });

        return 2000;
      },
    });

    return () => poll.stop();
  }, [project?.id, api, retry]);

  return { status, setStatus };
}
