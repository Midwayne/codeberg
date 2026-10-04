import { useProjectApi } from '@/lib/project-api';
import { Activity, ArrowLeft, BookOpen, Brain, FolderOpen, Palette, Puzzle, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  cleanupResources, formatBytes, loadResourceUsage, mergeResourceUsage, previewCleanup,
  type CleanupCategory, type CleanupPreview, type ResourceSample, type ResourceUsage,
} from '@/lib/resources';
import { ResourceChart } from '@/components/resource-chart';
import { ProjectExtensions } from '@/components/extensions';
import { LearningSettingsPanel } from '@/components/learning-settings';
import { AppearancePanel } from '@/components/appearance';
import { ProjectsPanel } from '@/components/projects';
import { cn } from '@/lib/utils';
import { ErrorNotice, Select } from '@/components/ui';

const sections = [
  { id: 'appearance', label: 'Appearance', shortLabel: 'Appearance', icon: Palette },
  { id: 'projects', label: 'Projects', shortLabel: 'Projects', icon: FolderOpen },
  { id: 'mcps', label: 'MCP servers', shortLabel: 'MCPs', icon: Puzzle },
  { id: 'skills', label: 'Skills', shortLabel: 'Skills', icon: BookOpen },
  { id: 'learning', label: 'Learning', shortLabel: 'Learning', icon: Brain },
  { id: 'usage', label: 'Resource usage', shortLabel: 'Usage', icon: Activity },
  { id: 'cleanup', label: 'Free up resources', shortLabel: 'Cleanup', icon: Trash2 },
] as const;

const labels: Record<CleanupCategory, string> = { chats: 'Saved chats', training: 'Training data', knowledge: 'Knowledge documents' };
const descriptions: Record<CleanupCategory, string> = {
  chats: 'Saved conversations, including archived chats. Pinned chats are kept.',
  training: 'Candidates and their training, evaluation, and dismissed copies. Recently reviewed examples are kept together.',
  knowledge: 'Generated service, flow, concept, and debugging documents. Original repository files are kept.',
};
const buttonClass = 'min-h-11 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50';

export function Settings({ onClose, onLearningSaved }: { onClose: () => void; onLearningSaved?: () => void }) {
  const [section, setSection] = useState<(typeof sections)[number]['id']>('appearance');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-8 p-4 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button type="button" onClick={onClose} aria-label="Back to chats" className={`${buttonClass} flex items-center gap-2`}><ArrowLeft className="size-4" /><span className="hidden sm:inline">Back to chats</span></button>
            <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">Settings</h1>
          </div>
          <OpenConfigDirectory />
        </div>
        <div className="grid items-start gap-6 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-10">
          <nav role="tablist" aria-label="Settings sections" aria-orientation="vertical" className="grid grid-cols-2 gap-1 sm:grid-cols-3 border-b border-border pb-3 md:sticky md:top-0 md:grid-cols-1 md:border-b-0 md:pb-0">
            {sections.map(({ id, label, shortLabel, icon: Icon }) => (
              <button key={id} type="button" role="tab" id={`settings-tab-${id}`} aria-label={label} aria-selected={section === id} aria-controls={`settings-panel-${id}`} tabIndex={section === id ? 0 : -1}
                onClick={() => setSection(id)} onKeyDown={(event) => {
                  const index = sections.findIndex((item) => item.id === id);
                  const next = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1
                    : ['ArrowRight', 'ArrowDown'].includes(event.key) ? (index + 1) % sections.length
                    : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? (index + sections.length - 1) % sections.length : undefined;
                  if (next === undefined) return;
                  event.preventDefault(); setSection(sections[next]!.id);
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
                }} className={cn('flex min-h-11 items-center justify-center gap-2 rounded-lg px-2 py-3 text-sm md:justify-start md:px-3 focus-visible:outline-2 focus-visible:outline-ring', section === id ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}>
                <Icon className="hidden size-4 shrink-0 min-[380px]:block" />
                <span className="md:hidden">{shortLabel}</span><span className="hidden md:inline">{label}</span>
              </button>
            ))}
          </nav>
          <div className="min-w-0">{sections.map(({ id }) => <div key={id} role="tabpanel" id={`settings-panel-${id}`} aria-labelledby={`settings-tab-${id}`} hidden={section !== id} tabIndex={0} className="focus-visible:outline-2 focus-visible:outline-ring">
            {section === id && <>{id === 'appearance' && <AppearancePanel />}
            {id === 'projects' && <ProjectsPanel />}
            {id === 'mcps' && <ProjectExtensions kind="mcp" />}
            {id === 'skills' && <ProjectExtensions kind="skill" />}
            {id === 'learning' && <LearningSettingsPanel onSaved={onLearningSaved} />}
            {id === 'usage' && <ResourceUsagePanel />}
            {id === 'cleanup' && <CleanupPanel />}</>}
          </div>)}</div>
        </div>
      </div>
    </main>
  );
}

function OpenConfigDirectory() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ path?: string; error?: string }>();
  return <div className="w-full space-y-2 sm:w-auto sm:max-w-sm">
    <button type="button" disabled={busy} className={`${buttonClass} flex w-full items-center justify-center gap-2 sm:w-auto sm:ml-auto`} onClick={() => {
      if (busy) return;
      setBusy(true); setResult(undefined);
      void fetch('/api/config/open-directory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then(async (response) => {
          const text = await response.text();
          let value: { path?: string; message?: string };
          try { value = JSON.parse(text) as typeof value; } catch { throw new Error(text || 'Could not open the config directory.'); }
          setResult({ path: value.path, error: response.ok ? undefined : value.message ?? 'Could not open the config directory.' });
        }).catch((reason: unknown) => setResult({ error: reason instanceof Error ? reason.message : String(reason) })).finally(() => setBusy(false));
    }}><FolderOpen aria-hidden="true" className="size-4" />{busy ? 'Opening…' : 'Open config directory'}</button>
    {result && <div role={result.error ? 'alert' : 'status'} className="break-words text-xs leading-5 sm:text-right">{result.error && <p className="text-destructive">{result.error}</p>}{result.path && <p className="text-muted-foreground">Config directory: <span className="break-all">{result.path}</span></p>}</div>}
  </div>;
}

function ResourceUsagePanel() {
  const { fetch: api } = useProjectApi();
  const [usage, setUsage] = useState<ResourceUsage>();
  const [error, setError] = useState('');
  const [range, setRange] = useState(60);
  const [retry, setRetry] = useState(0);
  const latest = useRef<ResourceUsage>(undefined);
  useEffect(() => {
    let active = true;
    let loading = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const warmUntil = Date.now() + 5000;
    const refresh = async () => {
      if (loading || document.hidden) return;
      if (timer) clearTimeout(timer);
      loading = true;
      try {
        const value = await loadResourceUsage(latest.current?.current?.timestamp, api);
        if (active) { latest.current = mergeResourceUsage(latest.current, value); setUsage(latest.current); setError(''); }
      }
      catch (failure) { if (active) setError(String(failure)); }
      finally {
        loading = false;
        if (active && !document.hidden) {
          const ready = Date.now() > warmUntil || Boolean(latest.current?.current?.disk);
          timer = setTimeout(() => void refresh(), ready ? 10_000 : 500);
        }
      }
    };
    void refresh();
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { active = false; if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
  }, [retry]);
  return <>
    {error && <ErrorNotice title="Could not load resource usage" detail={error} onRetry={() => { setError(''); setRetry((value) => value + 1); }} />}
    {usage ? <ResourceUsageView usage={usage} range={range} onRange={setRange} /> : !error && <p role="status" className="text-sm text-muted-foreground">Loading resource usage…</p>}
  </>;
}

export function ResourceUsageView({ usage, range, onRange }: { usage: ResourceUsage; range: number; onRange: (value: number) => void }) {
  const current = usage.current;
  const percent = (used: number, total: number) => total > 0 ? used / total * 100 : 0;
  const percentage = (value: number) => `${value.toFixed(2)}%`;
  const rows = usage.history.filter((row) => row.timestamp >= (current?.timestamp ?? Date.now()) - range * 60_000);
  const end = current?.timestamp ?? Date.now();
  const scopes: Record<ResourceSample['scope'], string> = {
    'managed-stack': 'This Codeberg instance: launcher, web server, learning, daemon, indexer, and managed workers.',
    'web-and-daemon': 'Web server, learning, local daemon, indexer, and their child processes.',
    'daemon-process-tree': 'Daemon, indexer, and their workers. The web process is registering with the collector.',
    'web-process-tree': 'Web server, learning, and their child processes. A separate daemon is not currently identified.',
    'web-process': 'Web server and learning only. Full process-tree measurements are unavailable on this system.',
  };
  return <section className="space-y-5" aria-label="Resource usage">
    <div><h2 className="text-lg font-semibold">Resource usage</h2><p className="mt-1 text-sm text-muted-foreground">Codeberg’s resource footprint. Samples every 10 seconds; one hour of history is kept by the background collector.</p></div>
    <div className="grid gap-3 sm:grid-cols-3">
      <Metric label="Codeberg CPU" value={current?.cpu.usedPercent != null ? percentage(current.cpu.usedPercent) : '—'}
        detail={current?.cpu.corePercent != null ? `Of total CPU capacity · ${current.cpu.corePercent.toFixed(1)}% of one core · ${current.cpu.cores} cores` : 'Waiting for a complete CPU interval…'} />
      <Metric label="Codeberg memory" value={current ? formatBytes(current.memory.usedBytes) : '—'}
        detail={current ? `${percentage(percent(current.memory.usedBytes, current.memory.totalBytes))} of ${formatBytes(current.memory.totalBytes)} physical RAM` : 'Waiting for first sample'} />
      <Metric label="Codeberg disk" value={current?.disk ? formatBytes(current.disk.codebergBytes) : '—'}
        detail={current?.disk ? 'Space occupied by Codeberg’s local data, models, and indexes' : 'Disk metrics unavailable'} />
    </div>
    <div className="rounded-xl border border-border p-4 text-sm">
      <h3 className="font-medium">Measured processes</h3>
      <p className="mt-2 text-muted-foreground">{current ? scopes[current.scope] : 'Waiting for process measurements.'}</p>
      <p className="mt-2 text-xs text-muted-foreground">CPU uses the change in process CPU time between samples. Memory is summed resident memory (RSS); shared pages may be counted by more than one process. Unrelated apps and the browser are excluded. Collection runs in {usage.collector === 'daemon' ? 'the daemon' : 'a dedicated worker'}; disk is refreshed every five minutes and after cleanup.</p>
      {current && <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs">
        <thead className="text-muted-foreground"><tr><th className="pb-2 font-medium">Process</th><th className="pb-2 font-medium">PID</th><th className="pb-2 font-medium">CPU (100% = one core)</th><th className="pb-2 font-medium">Resident memory</th></tr></thead>
        <tbody>{current.processes.map((item) => <tr key={item.pid} className="border-t border-border"><td className="py-2 pr-3">{item.name}</td><td className="pr-3 tabular-nums">{item.pid}</td><td className="pr-3 tabular-nums">{item.cpuPercent === null ? '—' : `${item.cpuPercent.toFixed(1)}%`}</td><td className="tabular-nums">{formatBytes(item.memoryBytes)}</td></tr>)}</tbody>
      </table></div>}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-medium">Usage history</h3><label className="text-sm">Time range <Select value={range} onChange={(event) => onRange(Number(event.currentTarget.value))} wrapperClassName="ml-2"><option value={5}>5 minutes</option><option value={15}>15 minutes</option><option value={60}>1 hour</option></Select></label></div>
    <div className="grid gap-3 sm:grid-cols-3">
      <ResourceChart title="CPU history" rows={rows.filter((row) => row.cpu.usedPercent !== null)} value={(row) => row.cpu.usedPercent ?? 0} format={percentage} range={range} end={end} />
      <ResourceChart title="Memory history" rows={rows} value={(row) => row.memory.usedBytes} format={formatBytes} range={range} end={end} />
      <ResourceChart title="Disk history" rows={rows.filter((row) => row.disk)} value={(row) => row.disk?.codebergBytes ?? 0} format={formatBytes} range={range} end={end} />
    </div>
    <p className="text-xs text-muted-foreground">Hover or tap a chart to inspect the exact sample value and time. Keyboard: focus a chart, then use ← / →.</p>
    {current && <p className="text-xs text-muted-foreground">Last sampled {new Date(current.timestamp).toLocaleTimeString()}. History resets when the collector restarts.{current.disk?.sampledAt ? ` Disk measured ${new Date(current.disk.sampledAt).toLocaleTimeString()}.` : ''}</p>}
  </section>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded-xl border border-border p-4"><h3 className="text-sm text-muted-foreground">{label}</h3><p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>;
}

function CleanupPanel() {
  const { fetch: api } = useProjectApi();
  const [days, setDays] = useState(30);
  const [selected, setSelected] = useState<CleanupCategory[]>([]);
  const [preview, setPreview] = useState<CleanupPreview>();
  const [previewError, setPreviewError] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setPreview(undefined);
    setPreviewError('');
    void previewCleanup(days, api).then((value) => { if (active) setPreview(value); }).catch((failure: unknown) => { if (active) setPreviewError(String(failure)); });
    return () => { active = false; };
  }, [days, revision]);
  const count = preview?.categories.filter((row) => selected.includes(row.category)).reduce((sum, row) => sum + row.count, 0) ?? 0;
  async function remove() {
    setBusy(true); setError(''); setResult('');
    try {
      const removed = await cleanupResources(selected, days, api);
      setResult(`Deleted ${removed.deleted} files and freed ${formatBytes(removed.bytesFreed)}.${removed.failed ? ` ${removed.failed} files could not be deleted. Check file permissions and try again.` : ''}`);
      window.dispatchEvent(new CustomEvent('codeberg:storage-cleaned', { detail: removed }));
      setConfirming(false); setSelected([]); setRevision((value) => value + 1);
    } catch (failure) { setError(String(failure)); setConfirming(false); setRevision((value) => value + 1); }
    finally { setBusy(false); }
  }
  return <section className="space-y-5" aria-label="Free up resources">
    <div><h2 className="text-lg font-semibold">Free up resources</h2><p className="mt-1 text-sm text-muted-foreground">Choose what to remove and how old it should be. Cleanup permanently deletes matching files.</p></div>
    {previewError && <ErrorNotice title="Could not calculate cleanup totals" detail={previewError} onRetry={() => setRevision((value) => value + 1)} />}
    <CleanupOptions preview={preview} unavailable={Boolean(previewError)} days={days} onDays={(value) => { setDays(value); setConfirming(false); setResult(''); setError(''); }} selected={selected} onSelect={(value) => { setSelected(value); setConfirming(false); }} busy={busy} onDelete={() => setConfirming(true)} />
    <p className="text-xs text-muted-foreground">Interaction/feedback source records and job receipts are kept to preserve provenance and prevent automatic regeneration on restart. New feedback or code changes may generate new training or knowledge data.</p>
    {confirming && <div className="space-y-3 rounded-xl border border-destructive p-4"><p className="text-sm">Permanently delete {count} matching files from {selected.map((category) => labels[category]).join(', ')}? This cannot be undone.</p><div className="flex gap-2"><button type="button" disabled={busy} onClick={() => void remove()} className="rounded-lg bg-destructive px-3 py-2 text-sm text-destructive-foreground disabled:opacity-50">{busy ? 'Deleting…' : 'Confirm deletion'}</button><button type="button" disabled={busy} onClick={() => setConfirming(false)} className={buttonClass}>Cancel</button></div></div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {result && <p role="status" className="text-sm">{result}</p>}
  </section>;
}

export function CleanupOptions({ preview, unavailable, selected, onSelect, days, onDays, busy, onDelete }: {
  preview?: CleanupPreview; selected: CleanupCategory[]; onSelect: (value: CleanupCategory[]) => void;
  unavailable?: boolean;
  days: number; onDays: (value: number) => void; busy: boolean; onDelete: () => void;
}) {
  const rows = preview?.categories;
  const matches = rows?.filter((row) => selected.includes(row.category)) ?? [];
  const count = matches.reduce((sum, row) => sum + row.count, 0);
  const bytes = matches.reduce((sum, row) => sum + row.bytes, 0);
  return <div className="space-y-4">
    <label className="block text-sm font-medium">Older than <Select value={days} disabled={busy} onChange={(event) => onDays(Number(event.currentTarget.value))} wrapperClassName="ml-2">{[7, 30, 90, 365].map((value) => <option key={value} value={value}>{value} days</option>)}<option value={0}>All ages</option></Select></label>
    <fieldset disabled={busy || !preview} className="space-y-3"><legend className="sr-only">Data to delete</legend>{(['chats', 'training', 'knowledge'] as const).map((category) => {
      const row = rows?.find((item) => item.category === category);
      return <label key={category} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4"><input type="checkbox" checked={selected.includes(category)} onChange={(event) => onSelect(event.currentTarget.checked ? [...selected, category] : selected.filter((item) => item !== category))} className="mt-1 size-5 shrink-0 accent-primary" /><span className="min-w-0 flex-1"><span className="text-sm font-medium">{labels[category]}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{descriptions[category]}</span></span><span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">{row ? <>{row.count} files<br />{formatBytes(row.bytes)}</> : unavailable ? 'Unavailable' : 'Calculating…'}</span></label>;
    })}</fieldset>
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{count} files selected · {formatBytes(bytes)} reclaimable</p><button type="button" disabled={busy || !preview || !count} onClick={onDelete} className={`${buttonClass} text-destructive`}>Delete selected data…</button></div>
  </div>;
}
