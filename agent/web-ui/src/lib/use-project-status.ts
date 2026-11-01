import { useEffect, useState } from 'react';

import type { Project, ProjectStatus } from './project-api';
import { missingProject, requestProjectStatus, transientStatusError } from './project-status-request';

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

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let last: ProjectStatus | undefined;
    let failures = 0;
    const poll = async () => {
      let ready = false;
      try {
        const value = await requestProjectStatus(api, controller.signal);
        if (controller.signal.aborted) return;

        last = value;
        failures = 0;
        ready = value.ready && !value.indexing;
        setStatus({ id: project.id, value });
      } catch (reason) {
        if (controller.signal.aborted) return;
        if (missingProject(reason)) refreshCatalog?.((value) => value + 1);

        failures++;
        const transient = transientStatusError(reason);
        if (!transient || failures > 1) setStatus({ id: project.id, value: last,
          error: transient ? 'Could not check project status. Retrying automatically. Last reported progress may be out of date.'
            : reason instanceof Error ? reason.message : String(reason) });
      }

      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), ready ? 10000 : 2000);
    };
    void poll();

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [project?.id, api, retry]);

  return { status, setStatus };
}
