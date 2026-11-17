import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { projectFetch, type ProjectCatalog } from './project-api';
import { ProjectToolbar, ProjectNotice } from '../components/project-controls';
import { useProjectStatus } from './use-project-status';
import { requestProjectCatalog } from './project-catalog-request';
import { errorMessage } from '@agent/core/errors.js';

export { useProjectStatus, type ProjectStatusOptions } from './use-project-status';

export type ProjectShellOptions = {
  children: (toolbar: ReactNode, loading: boolean, notice: ReactNode) => ReactNode;
};

export function useProjectShell({ children }: ProjectShellOptions) {
  const { catalog, setCatalog, selected, setSelected, error, retry, setRetry } = useProjectCatalog();
  const [adding, setAdding] = useState(false);
  const project = catalog?.projects.find((project) => project.id === selected);
  const api = useMemo(() => (project ? projectFetch(project.id) : projectFetch('unselected')), [project?.id]);
  const { status, setStatus } = useProjectStatus({ project, api, retry, refreshCatalog: setRetry });

  function select(id: string) {
    setSelected(id);
    try {
      sessionStorage.setItem('codeberg-project', id);
    } catch {
      /* selection still works */
    }
    const url = new URL(window.location.href);
    url.searchParams.set('project', id);
    window.history.replaceState(null, '', url);
  }
  const currentStatus = status?.id === project?.id ? status : undefined;
  const vectorsEnabled = catalog?.vectorsEnabled ?? currentStatus?.value?.vectors_enabled;
  const indexing = vectorsEnabled !== false && (!currentStatus?.value?.ready || currentStatus.value.indexing);
  const ready = Boolean(project);
  const toolbar = (
    <ProjectToolbar project={project} selected={selected} catalog={catalog} select={select} setAdding={setAdding} />
  );
  const notice = project && (currentStatus?.error || indexing) && (
    <ProjectNotice
      key={project.id}
      vectorsEnabled={vectorsEnabled}
      currentStatus={currentStatus}
      project={project}
      api={api}
      setRetry={setRetry}
      setStatus={setStatus}
    />
  );
  return { catalog, project, api, ready, setCatalog, children, toolbar, notice, error, setRetry, adding, setAdding, select };
}

/**
 * Loads the projects and keeps a valid selection: current, then the URL, then
 * the last session, then the default. Bumping `retry` loads them again.
 */
function useProjectCatalog() {
  const [catalog, setCatalog] = useState<ProjectCatalog>();
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void requestProjectCatalog(controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        const requested = new URLSearchParams(window.location.search).get('project');
        let remembered: string | null = null;
        try {
          remembered = sessionStorage.getItem('codeberg-project');
        } catch {
          /* storage may be unavailable */
        }
        setCatalog(next);
        setSelected(
          (current) =>
            [current, requested, remembered, next.defaultId].find((id) =>
              next.projects.some((project) => project.id === id),
            ) ?? next.defaultId,
        );
        setError('');
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(reason));
      });
    return () => controller.abort();
  }, [retry]);

  return { catalog, setCatalog, selected, setSelected, error, retry, setRetry };
}
