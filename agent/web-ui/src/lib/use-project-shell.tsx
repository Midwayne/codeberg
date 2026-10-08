import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { projectFetch, type Project, type ProjectCatalog, type ProjectStatus } from './project-api';
import { ProjectToolbar, ProjectNotice } from '../components/project-controls';

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
  const ready = currentStatus?.value?.ready === true;
  const toolbar = (
    <ProjectToolbar project={project} selected={selected} catalog={catalog} select={select} setAdding={setAdding} />
  );
  const notice = project && !ready && (
    <ProjectNotice
      currentStatus={currentStatus}
      project={project}
      api={api}
      setRetry={setRetry}
      setStatus={setStatus}
    />
  );
  return { catalog, project, api, ready, setCatalog, children, toolbar, notice, error, setRetry, adding, setAdding, select };
}

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
    const poll = async () => {
      let ready = false;
      try {
        const response = await api('/api/project/status', {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(7000)]),
        });
        if (response.status === 404) refreshCatalog?.((value) => value + 1);
        if (!response.ok) throw new Error(await response.text());
        const value = (await response.json()) as ProjectStatus;
        ready = value.ready;
        if (!controller.signal.aborted) setStatus({ id: project.id, value });
      } catch (reason) {
        if (!controller.signal.aborted) setStatus({ id: project.id, error: String(reason) });
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
