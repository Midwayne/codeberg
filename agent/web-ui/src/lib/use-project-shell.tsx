import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { projectFetch, type ProjectCatalog } from './project-api';
import { ProjectToolbar, ProjectNotice } from '../components/project-controls';
import { useProjectStatus } from './use-project-status';

export { useProjectStatus, type ProjectStatusOptions } from './use-project-status';

export type ProjectShellOptions = {
  children: (toolbar: ReactNode, loading: boolean, notice: ReactNode) => ReactNode;
};

export function useProjectShell({ children }: ProjectShellOptions) {
  const [catalog, setCatalog] = useState<ProjectCatalog>();
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
  const ready = Boolean(project);
  const toolbar = (
    <ProjectToolbar project={project} selected={selected} catalog={catalog} select={select} setAdding={setAdding} />
  );
  const notice = project && (currentStatus?.error || !currentStatus?.value?.ready || currentStatus.value.indexing) && (
    <ProjectNotice
      key={project.id}
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
  setCatalog: React.Dispatch<React.SetStateAction<ProjectCatalog | undefined>>;
  setSelected: React.Dispatch<React.SetStateAction<string>>;
  setError: React.Dispatch<React.SetStateAction<string>>;
  retry: number;
};

export function useProjectCatalog({ setCatalog, setSelected, setError, retry }: ProjectCatalogOptions) {
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/projects', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        const next = (await response.json()) as ProjectCatalog;
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
