import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ErrorNotice, Select } from '@/components/ui';
import { SkillImport } from '@/components/skill-import';
import { useProjectApi, type Project } from '@/lib/project-api';

const control = 'min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-base sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const button = 'min-h-11 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50';

export function ProjectExtensions({ kind }: { kind: 'mcp' | 'skill' }) {
  const { project, fetch: api } = useProjectApi();
  return project ? <Extensions key={`${project.id}:${kind}`} project={project} api={api} kind={kind} />
    : <p role="status" className="text-sm text-muted-foreground">Select a project to manage its MCPs and skills.</p>;
}

interface ExtensionCatalog { mcps: { name: string; kind: string; scope?: string }[]; skills: { name: string; description: string; scope: string }[]; warnings: string[] }
function Extensions({ project, api, kind }: { project: Project; api: typeof fetch; kind: 'mcp' | 'skill' }) {
  const [catalog, setCatalog] = useState<ExtensionCatalog>(); const [revision, setRevision] = useState(0);
  const [catalogError, setCatalogError] = useState('');
  const [scope, setScope] = useState('project');
  const [importing, setImporting] = useState(false);
  const title = kind === 'mcp' ? 'MCP servers' : 'Skills';
  const entries = kind === 'mcp' ? catalog?.mcps : catalog?.skills;
  const [name, setName] = useState(''); const [config, setConfig] = useState('');
  const [description, setDescription] = useState(''); const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [saved, setSaved] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setCatalogError('');
    void api('/api/extensions', { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(await response.text());
      const next = await response.json() as ExtensionCatalog;
      if (!controller.signal.aborted) setCatalog(next);
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setCatalogError(String(reason)); });
    return () => controller.abort();
  }, [api, revision]);
  return <section aria-label={title} className="space-y-6">
      <div><h2 className="text-lg font-semibold">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{project.name} inherits global tools and skills. Project entries take precedence.</p></div>
      {catalogError && <ErrorNotice title={`Could not load ${title}`} detail={catalogError} onRetry={() => setRevision((value) => value + 1)} />}
      <section aria-label={`Available ${title}`}><h3 className="mb-2 text-sm font-medium">Available {title === 'Skills' ? 'skills' : 'MCP servers'}</h3>{!catalog ? catalogError ? <p className="text-xs text-muted-foreground">Catalog unavailable.</p> : <p role="status" className="text-xs text-muted-foreground">Loading…</p> : !entries?.length ? <p className="text-xs text-muted-foreground">None available yet.</p> : <ul className="divide-y divide-border">{entries.map((item) => <li key={item.name} className="flex items-start justify-between gap-3 py-3 text-sm"><div className="min-w-0"><p className="break-words">{item.name}</p></div><span className="shrink-0 text-xs text-muted-foreground">{item.scope ?? ('kind' in item ? item.kind : '')}</span></li>)}</ul>}</section>
      {kind === 'mcp' && catalog?.warnings.map((warning) => <p key={warning} role="status" className="break-words text-xs text-muted-foreground">{warning}</p>)}
      <label className="block space-y-2 text-sm"><span className="block">Available in</span><Select disabled={busy || importing} value={scope} onChange={(event) => setScope(event.target.value)}><option value="project">{project.name}</option><option value="global">All projects</option></Select></label>
      {kind === 'skill' && <SkillImport api={api} scope={scope} scopeLabel={scope === 'global' ? 'All projects' : project.name} onImported={() => setRevision((value) => value + 1)} onBusyChange={setImporting} />}
      <form className="space-y-4 border-t border-border pt-5" onSubmit={(event) => {
        event.preventDefault(); if (busy || importing) return; setError(''); setSaved(''); setBusy(true);
        void Promise.resolve().then(async () => {
          const body = kind === 'mcp' ? { kind, scope, name, config: JSON.parse(config) as unknown }
            : { kind, scope, name, content: `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n\n${instructions}\n` };
          const response = await api('/api/extensions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          if (!response.ok) throw new Error(await response.text());
          setSaved(`${name} added. Available on the next chat turn.`); setName(''); setConfig(''); setDescription(''); setInstructions(''); setRevision((value) => value + 1);
        }).catch((reason: unknown) => setError(String(reason))).finally(() => setBusy(false));
      }}>
        <h3 className="text-sm font-medium">{kind === 'mcp' ? 'Add an MCP server' : 'Write a skill'}</h3>
        <fieldset disabled={busy || importing} className="space-y-4">
        <label className="block space-y-2 text-sm"><span>Name</span><input required pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,63}" value={name} onChange={(event) => setName(event.target.value)} className={control} /></label>
        {kind === 'mcp' ? <label className="block space-y-2 text-sm"><span>Server configuration (JSON)</span><textarea required rows={5} value={config} onChange={(event) => setConfig(event.target.value)} placeholder={'{"url": "https://your-server.example/mcp"}\nOr use {"command": "…", "args": []} for a local server.'} className={`${control} resize-y font-mono`} /><span className="block text-xs leading-5 text-muted-foreground">Supports command, args, env, URL and headers. Use environment references for credentials.</span></label> : <><label className="block space-y-2 text-sm"><span>Description</span><input required value={description} onChange={(event) => setDescription(event.target.value)} className={control} /></label><label className="block space-y-2 text-sm"><span>Instructions</span><textarea required rows={5} value={instructions} onChange={(event) => setInstructions(event.target.value)} className={`${control} resize-y`} /></label></>}
        </fieldset>
        {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}{saved && <p role="status" className="text-sm">{saved}</p>}
        <button type="submit" disabled={busy || importing} className={`${button} inline-flex items-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90`}><Plus className="size-4" />{busy ? 'Adding…' : kind === 'mcp' ? 'Add MCP server' : 'Add skill'}</button>
      </form>
  </section>;
}
