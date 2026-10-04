import { ChevronDown, Folder, FolderPlus, Pencil, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { CopyButton, Dialog, ErrorNotice, IconButton, Select } from '@/components/ui';
import { ProjectApiContext, projectFetch, useProjectApi, type Project, type ProjectCatalog, type ProjectStatus } from '@/lib/project-api';

const control = 'min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-base sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const button = 'min-h-11 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50';

export function ProjectShell({ children }: { children: (toolbar: ReactNode, loading: boolean, notice: ReactNode) => ReactNode }) {
  const [catalog, setCatalog] = useState<ProjectCatalog>();
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [adding, setAdding] = useState(false);
  const project = catalog?.projects.find((project) => project.id === selected);
  const api = useMemo(() => project ? projectFetch(project.id) : projectFetch('unselected'), [project?.id]);
  const [status, setStatus] = useState<{ id: string; value?: ProjectStatus; error?: string }>();

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/projects', { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(await response.text());
      const next = await response.json() as ProjectCatalog;
      if (controller.signal.aborted) return;
      const requested = new URLSearchParams(window.location.search).get('project');
      let remembered: string | null = null;
      try { remembered = sessionStorage.getItem('codeberg-project'); } catch { /* storage may be unavailable */ }
      setCatalog(next);
      setSelected((current) => [current, requested, remembered, next.defaultId].find((id) => next.projects.some((project) => project.id === id)) ?? next.defaultId);
      setError('');
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(String(reason)); });
    return () => controller.abort();
  }, [retry]);

  useEffect(() => {
    if (!project) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let ready = false;
      try {
        const response = await api('/api/project/status', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(7000)]) });
        if (!response.ok) throw new Error(await response.text());
        const value = await response.json() as ProjectStatus;
        ready = value.ready;
        if (!controller.signal.aborted) setStatus({ id: project.id, value });
      } catch (reason) { if (!controller.signal.aborted) setStatus({ id: project.id, error: String(reason) }); }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), ready ? 10000 : 2000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [project?.id, api, retry]);

  function select(id: string) {
    setSelected(id);
    try { sessionStorage.setItem('codeberg-project', id); } catch { /* selection still works */ }
    const url = new URL(window.location.href);
    url.searchParams.set('project', id);
    window.history.replaceState(null, '', url);
  }
  const currentStatus = status?.id === project?.id ? status : undefined;
  const ready = currentStatus?.value?.ready === true;
  const toolbar = <div className="flex min-w-0 flex-1 items-center gap-1">
    <Select aria-label="Project" title={project?.roots.map((root) => root.root).join('\n')} value={selected} disabled={!catalog} onChange={(event) => select(event.target.value)} className="font-semibold sm:text-base">
      {!catalog && <option value="">Loading projects…</option>}
      {catalog?.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
    </Select>
    <IconButton aria-label="Add project" title="Add project" disabled={!catalog} onClick={() => setAdding(true)} className="size-11 sm:size-11"><FolderPlus className="size-4" /></IconButton>
  </div>;
  const notice = project && !ready && <div role={currentStatus?.error ? 'alert' : 'status'} className="flex shrink-0 items-start gap-3 rounded-lg border border-border bg-popover p-4 text-popover-foreground mx-3 my-2">
      <div className="min-w-0 flex-1"><p className="text-sm font-medium">{currentStatus?.error ? 'Project index unavailable' : `Indexing ${project.name}…`}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{currentStatus?.error ?? `${currentStatus?.value?.chunks ?? 0} chunks indexed. You can read chats and draft a question while Codeberg prepares search.`}</p>
      </div>
      {currentStatus?.error && <button type="button" className={button} onClick={() => { void api('/api/project/retry', { method: 'POST' }).then((response) => { if (!response.ok) throw new Error('Retry failed'); setRetry((value) => value + 1); }).catch((reason: unknown) => setStatus({ id: project.id, error: String(reason) })); }}>Retry</button>}
    </div>;
  return <ProjectApiContext.Provider key={project?.id ?? 'loading'} value={{ project, fetch: api, ready, onProjectRenamed: (updated) => {
    setCatalog((current) => current && { ...current, projects: current.projects.map((project) => project.id === updated.id ? updated : project) });
  } }}>
    {children(toolbar, !project, notice)}
    {error && <div className="fixed inset-x-4 bottom-4 z-40"><ErrorNotice title="Could not load projects" detail={error} onRetry={() => setRetry((value) => value + 1)} /></div>}

    {adding && <AddProject initialPath={project?.roots[0]?.root} onClose={() => setAdding(false)} onAdded={async (project) => {
      const response = await fetch('/api/projects');
      if (!response.ok) throw new Error(await response.text());
      setCatalog(await response.json() as ProjectCatalog); select(project.id); setAdding(false);
    }} />}
  </ProjectApiContext.Provider>;
}

export function ProjectsPanel() {
  const { project: selectedProject, onProjectRenamed } = useProjectApi();
  const [catalog, setCatalog] = useState<ProjectCatalog>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void fetch('/api/projects', { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(await response.text());
      const value = await response.json() as ProjectCatalog;
      if (!controller.signal.aborted) setCatalog(value);
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => controller.abort();
  }, [retry]);
  return <section className="space-y-6" aria-labelledby="projects-heading">
    <div className="space-y-2"><h2 id="projects-heading" className="text-lg font-semibold">Projects</h2>
      <p className="max-w-prose text-sm leading-6 text-muted-foreground">Manage project names and find their config files.</p>
    </div>
    {error && <ErrorNotice title="Could not load projects" detail={error} onRetry={() => setRetry((value) => value + 1)} />}
    {!catalog && !error && <p role="status" className="text-sm text-muted-foreground">Loading projects…</p>}
    {catalog?.projects.length === 0 && <p className="text-sm leading-6 text-muted-foreground">No projects yet. Use Add project in the chat sidebar to choose a repository.</p>}
    <div className="divide-y divide-border">{catalog?.projects.map((project) => <ProjectDetails key={project.id} project={project} current={project.id === selectedProject?.id} onRenamed={(updated) => {
      setCatalog((current) => current && { ...current, projects: current.projects.map((project) => project.id === updated.id ? updated : project) });
      onProjectRenamed?.(updated);
    }} />)}</div>
    {catalog?.catalogPath && <div className="space-y-2 border-t border-border pt-5">
      <p className="text-sm font-medium">Project catalog</p>
      <div className="flex min-w-0 items-start justify-between gap-3"><code className="min-w-0 break-all text-xs leading-6 text-muted-foreground select-all">{catalog.catalogPath}</code><CopyButton text={catalog.catalogPath} label="Copy project catalog path" /></div>
      <p className="text-xs leading-5 text-muted-foreground">Maps project names and directories to their IDs. Renaming keeps your chats and indexed data in place.</p>
    </div>}
  </section>;
}

export function ProjectDetails({ project, current = false, onRenamed }: { project: Project; current?: boolean; onRenamed: (project: Project) => void }) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const renameButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (!editing && wasEditing.current) renameButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  return <article className="min-w-0 space-y-4 py-6 first:pt-0" aria-label={project.name}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><h3 className="min-w-0 max-w-full break-words text-base font-semibold">{project.name}</h3>
          {current && <span className="rounded-md bg-accent px-2 py-1 text-xs text-accent-foreground">Current project</span>}
        </div>
        {saved && <p role="status" className="text-xs text-muted-foreground">Project name saved.</p>}
      </div>
      {!editing && <button ref={renameButton} type="button" aria-label={`Rename ${project.name}`} onClick={() => { setEditing(true); setSaved(false); }} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><Pencil aria-hidden="true" className="size-3.5" />Rename</button>}
    </div>
    {editing && <RenameProjectForm project={project} onCancel={() => setEditing(false)} onRenamed={(updated) => { onRenamed(updated); setEditing(false); setSaved(true); }} />}
    <dl className="space-y-3 text-sm">
      {project.roots.map((root) => <ProjectLocation key={root.key} label="Directory" value={root.root} copyLabel={`Copy directory path for ${root.key}`}>
        <span className="block break-words font-medium">{root.root.split(/[\\/]/).filter(Boolean).at(-1) || root.root}</span>
      </ProjectLocation>)}
      <ProjectLocation label="Project ID" value={project.id} copyLabel={`Copy project ID for ${project.name}`} />
      {project.configDirectory && <ProjectLocation label="Config directory" value={project.configDirectory} copyLabel={`Copy config directory for ${project.name}`} />}
    </dl>
    {project.configDirectory && <details className="group min-w-0 sm:ml-35">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"><ChevronDown aria-hidden="true" className="size-3.5 -rotate-90 transition-transform group-open:rotate-0 motion-reduce:transition-none" />Config files</summary>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 pb-1 text-xs leading-5">
        <dt><code>mcp.json</code></dt><dd className="text-muted-foreground">MCP servers</dd>
        <dt><code>skills/</code></dt><dd className="text-muted-foreground">Project skills</dd>
        <dt><code>spec.yml</code></dt><dd className="text-muted-foreground">Database connections</dd>
      </dl>
    </details>}
  </article>;
}

function ProjectLocation({ label, value, copyLabel, children }: { label: string; value: string; copyLabel: string; children?: ReactNode }) {
  return <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 sm:grid-cols-[8rem_minmax(0,1fr)_auto]">
    <dt className="col-span-2 text-xs leading-6 text-muted-foreground sm:col-span-1">{label}</dt>
    <dd className="min-w-0 space-y-0.5 leading-6">{children}<code className="block break-all text-xs leading-6 text-muted-foreground select-all">{value}</code></dd>
    <dd><CopyButton text={value} label={copyLabel} /></dd>
  </div>;
}

export function RenameProjectForm({ project, onRenamed, onCancel }: { project: Project; onRenamed: (project: Project) => void; onCancel: () => void }) {
  const [name, setName] = useState(project.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  return <form className="space-y-3 rounded-lg bg-muted/40 p-4" onKeyDown={(event) => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopPropagation(); onCancel(); }
    }} onSubmit={(event) => {
      event.preventDefault();
      if (busy || !name.trim() || name.trim() === project.name) return;
      setBusy(true); setError('');
      void fetch(`/api/projects/${project.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) })
        .then(async (response) => {
          const text = await response.text();
          let result: Project & { message?: string };
          try { result = JSON.parse(text) as typeof result; } catch { throw new Error(text || 'Could not save the project name. Try again.'); }
          if (!response.ok) throw new Error(result.message || 'Could not save the project name. Try again.');
          onRenamed(result);
        }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => setBusy(false));
    }}>
      <label htmlFor={`project-name-${project.id}`} className="block text-sm font-medium">Project name</label>
      <input ref={input} id={`project-name-${project.id}`} required maxLength={120} value={name} disabled={busy} onChange={(event) => { setName(event.target.value); setError(''); }} className={control} />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" disabled={busy} onClick={onCancel} className={`${button} focus-visible:outline-2 focus-visible:outline-ring`}>Cancel</button>
        <button type="submit" disabled={busy || !name.trim() || name.trim() === project.name} className="min-h-11 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50">{busy ? 'Saving…' : 'Save name'}</button>
      </div>
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    </form>;
}

export function AddProject({ initialPath, onClose, onAdded }: { initialPath?: string; onClose: () => void; onAdded: (project: Project) => Promise<void> }) {
  const [root, setRoot] = useState(''); const [name, setName] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [choosing, setChoosing] = useState(false);
  const picker = useRef<AbortController | null>(null);
  const directoryInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => picker.current?.abort(), []);
  async function chooseFolder() {
    if (busy || picker.current) return;
    const controller = new AbortController();
    picker.current = controller;
    setChoosing(true); setError('');
    try {
      const response = await fetch('/api/projects/pick-directory', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initialPath: root || initialPath }), signal: controller.signal,
      });
      const text = await response.text();
      let result: { path?: string; cancelled?: boolean; message?: string };
      try { result = JSON.parse(text) as typeof result; } catch { throw new Error(text || 'Could not open the folder picker. Enter the directory path manually.'); }
      if (!response.ok) throw new Error(result.message || 'Could not open the folder picker. Enter the directory path manually.');
      if (!controller.signal.aborted && !result.cancelled) {
        if (!result.path) throw new Error('No directory was selected. Choose a folder again or enter the path manually.');
        setRoot(result.path);
      }
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally {
      if (!controller.signal.aborted) { setChoosing(false); directoryInput.current?.focus(); }
      picker.current = null;
    }
  }
  return <Dialog label="Add project" onClose={onClose} className="m-auto w-[calc(100vw-2rem)] max-w-xl">
    <form className="space-y-5 p-5 sm:p-6" onSubmit={(event) => {
      event.preventDefault();
      if (choosing || busy || !root.trim()) return;
      setBusy(true); setError('');
      void fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, root }) })
        .then(async (response) => { if (!response.ok) throw new Error(await response.text()); await onAdded(await response.json() as Project); })
        .catch((reason: unknown) => setError(String(reason))).finally(() => setBusy(false));
    }}>
      <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Add project</h2><IconButton aria-label="Close add project" onClick={onClose}><X className="size-4" /></IconButton></div>
      <p className="text-sm leading-6 text-muted-foreground">Chats, knowledge and training data stay with this project.</p>
      <div className="space-y-2">
        <label htmlFor="project-directory" className="block text-sm">Directory path</label>
        <div role="group" aria-label="Project directory" className="flex min-w-0 items-stretch overflow-hidden rounded-xl border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
          <button type="button" aria-label="Choose folder" title="Choose folder" disabled={choosing || busy} onClick={() => void chooseFolder()} className="inline-flex min-h-12 w-12 shrink-0 items-center justify-center border-r border-input text-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50"><Folder className="size-5" /></button>
          <input id="project-directory" ref={directoryInput} aria-describedby="project-directory-help" required value={root} disabled={choosing || busy} onChange={(event) => setRoot(event.target.value)} placeholder="/path/to/project" className="min-h-12 min-w-0 flex-1 bg-transparent px-4 py-3 text-base placeholder:text-muted-foreground focus-visible:outline-none disabled:opacity-50 sm:text-sm" />
        </div>
        <p id="project-directory-help" className="text-xs text-muted-foreground">Use the folder button or enter the directory path manually.</p>
        {choosing && <p role="status" className="text-sm text-muted-foreground">Select a folder in the system dialog, or cancel to return here.</p>}
      </div>
      <label className="block space-y-2 text-sm"><span>Project name <span className="text-muted-foreground">(optional)</span></span><input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} className={control} /></label>
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className={button} onClick={onClose}>Cancel</button><button type="submit" disabled={busy || choosing || !root.trim()} className={`${button} bg-primary text-primary-foreground hover:bg-primary/90`}>{busy ? 'Adding…' : 'Add project'}</button></div>
    </form>
  </Dialog>;
}
