import type { ProjectCatalogInfo } from '@agent/core/api/projects.js';
import { responseJson } from './response.js';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { projectFetch } from './project-api';
import { ProjectToolbar } from '../components/project-controls';
import { ProjectNotice } from '../components/indexing-progress';
import { useProjectStatus } from './use-project-status';

export type ProjectShellOptions = {
  children: (toolbar: ReactNode, loading: boolean, notice: ReactNode) => ReactNode;
};

export function useProjectShell({ children }: ProjectShellOptions) {
  const [catalog, setCatalog] = useState<ProjectCatalogInfo>();
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [adding, setAdding] = useState(false);
  const project = catalog?.projects.find((project) => project.id === selected);
  const api = useMemo(() => (project ? projectFetch(project.id) : projectFetch('unselected')), [project?.id]);
  const { status, setStatus } = useProjectStatus({ project, api, retry, refreshCatalog: setRetry });
  useProjectCatalog({ setCatalog, setSelected, setError, retry });

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

export type ProjectCatalogOptions = {
  setCatalog: React.Dispatch<React.SetStateAction<ProjectCatalogInfo | undefined>>;
  setSelected: React.Dispatch<React.SetStateAction<string>>;
  setError: React.Dispatch<React.SetStateAction<string>>;
  retry: number;
};

export function useProjectCatalog({ setCatalog, setSelected, setError, retry }: ProjectCatalogOptions) {
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/projects', { signal: controller.signal })
      .then(async (response) => {
        const next = await responseJson<ProjectCatalogInfo>(response);
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
        if (!controller.signal.aborted) setError(String(reason));
      });
    return () => controller.abort();
  }, [retry]);
}
