import { Activity, ArrowLeft, Palette, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  cleanupResources, formatBytes, loadResourceUsage, mergeResourceUsage, previewCleanup,
  type CleanupCategory, type CleanupPreview, type ResourceSample, type ResourceUsage,
} from '@/lib/resources';
import { ResourceChart } from '@/components/resource-chart';
import { AppearancePanel } from '@/components/appearance';

const labels: Record<CleanupCategory, string> = { chats: 'Saved chats', training: 'Training data', knowledge: 'Knowledge documents' };
const descriptions: Record<CleanupCategory, string> = {
  chats: 'Saved conversations, including archived chats. Pinned chats are kept.',
  training: 'Candidates and their training, evaluation, and dismissed copies. Recently reviewed examples are kept together.',
  knowledge: 'Generated service, flow, concept, and debugging documents. Original repository files are kept.',
};
const buttonClass = 'rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50';

export function Settings({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<'appearance' | 'usage' | 'cleanup'>('usage');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button type="button" onClick={onClose} aria-label="Back to chats" className={buttonClass}><ArrowLeft className="size-4" /></button>
            <h1 ref={heading} tabIndex={-1} className="text-xl font-semibold outline-none">Settings</h1>
          </div>
        </div>
        <nav aria-label="Settings sections" className="flex flex-wrap gap-2 border-b border-border pb-4">
          <button type="button" onClick={() => setSection('appearance')} aria-current={section === 'appearance' ? 'page' : undefined} className={`${buttonClass} flex items-center gap-2 ${section === 'appearance' ? 'bg-accent' : ''}`}><Palette className="size-4" />Appearance</button>
          <button type="button" onClick={() => setSection('usage')} aria-current={section === 'usage' ? 'page' : undefined} className={`${buttonClass} flex items-center gap-2 ${section === 'usage' ? 'bg-accent' : ''}`}><Activity className="size-4" />Resource usage</button>
          <button type="button" onClick={() => setSection('cleanup')} aria-current={section === 'cleanup' ? 'page' : undefined} className={`${buttonClass} flex items-center gap-2 ${section === 'cleanup' ? 'bg-accent' : ''}`}><Trash2 className="size-4" />Free up resources</button>
        </nav>
        {section === 'appearance' && <AppearancePanel />}
        {section === 'usage' && <ResourceUsagePanel />}
        {section === 'cleanup' && <CleanupPanel />}
      </div>
    </main>
  );
}

function ResourceUsagePanel() {
  const [usage, setUsage] = useState<ResourceUsage>();
  const [error, setError] = useState('');
  const [range, setRange] = useState(60);
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
        const value = await loadResourceUsage(latest.current?.current?.timestamp);
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
  }, []);
  return <>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {usage ? <ResourceUsageView usage={usage} range={range} onRange={setRange} /> : <p role="status" className="text-sm text-muted-foreground">Loading resource usage…</p>}
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
    <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium">Usage history</h3><label className="text-sm">Time range <select value={range} onChange={(event) => onRange(Number(event.currentTarget.value))} className="ml-2 rounded-md border border-border bg-background px-2 py-1"><option value={5}>5 minutes</option><option value={15}>15 minutes</option><option value={60}>1 hour</option></select></label></div>
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
  const [days, setDays] = useState(30);
  const [selected, setSelected] = useState<CleanupCategory[]>([]);
  const [preview, setPreview] = useState<CleanupPreview>();
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setPreview(undefined);
    void previewCleanup(days).then((value) => { if (active) setPreview(value); }).catch((failure: unknown) => { if (active) setError(String(failure)); });
    return () => { active = false; };
  }, [days, revision]);
  const count = preview?.categories.filter((row) => selected.includes(row.category)).reduce((sum, row) => sum + row.count, 0) ?? 0;
  async function remove() {
    setBusy(true); setError(''); setResult('');
    try {
      const removed = await cleanupResources(selected, days);
      setResult(`Deleted ${removed.deleted} files and freed ${formatBytes(removed.bytesFreed)}.${removed.failed ? ` ${removed.failed} files could not be deleted. Check file permissions and try again.` : ''}`);
      window.dispatchEvent(new CustomEvent('codeberg:storage-cleaned', { detail: removed }));
      setConfirming(false); setSelected([]); setRevision((value) => value + 1);
    } catch (failure) { setError(String(failure)); setConfirming(false); setRevision((value) => value + 1); }
    finally { setBusy(false); }
  }
  return <section className="space-y-5" aria-label="Free up resources">
    <div><h2 className="text-lg font-semibold">Free up resources</h2><p className="mt-1 text-sm text-muted-foreground">Choose what to remove and how old it should be. Cleanup permanently deletes matching files.</p></div>
    <CleanupOptions preview={preview} days={days} onDays={(value) => { setDays(value); setConfirming(false); setResult(''); setError(''); }} selected={selected} onSelect={(value) => { setSelected(value); setConfirming(false); }} busy={busy} onDelete={() => setConfirming(true)} />
    <p className="text-xs text-muted-foreground">Interaction/feedback source records and job receipts are kept to preserve provenance and prevent automatic regeneration on restart. New feedback or code changes may generate new training or knowledge data.</p>
    {confirming && <div className="space-y-3 rounded-xl border border-destructive p-4"><p className="text-sm">Permanently delete {count} matching files from {selected.map((category) => labels[category]).join(', ')}? This cannot be undone.</p><div className="flex gap-2"><button type="button" disabled={busy} onClick={() => void remove()} className="rounded-lg bg-destructive px-3 py-2 text-sm text-destructive-foreground disabled:opacity-50">{busy ? 'Deleting…' : 'Confirm deletion'}</button><button type="button" disabled={busy} onClick={() => setConfirming(false)} className={buttonClass}>Cancel</button></div></div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {result && <p role="status" className="text-sm">{result}</p>}
  </section>;
}

export function CleanupOptions({ preview, selected, onSelect, days, onDays, busy, onDelete }: {
  preview?: CleanupPreview; selected: CleanupCategory[]; onSelect: (value: CleanupCategory[]) => void;
  days: number; onDays: (value: number) => void; busy: boolean; onDelete: () => void;
}) {
  const rows = preview?.categories;
  const matches = rows?.filter((row) => selected.includes(row.category)) ?? [];
  const count = matches.reduce((sum, row) => sum + row.count, 0);
  const bytes = matches.reduce((sum, row) => sum + row.bytes, 0);
  return <div className="space-y-4">
    <label className="block text-sm font-medium">Older than <select value={days} disabled={busy} onChange={(event) => onDays(Number(event.currentTarget.value))} className="ml-2 rounded-md border border-border bg-background px-3 py-2">{[7, 30, 90, 365].map((value) => <option key={value} value={value}>{value} days</option>)}<option value={0}>All ages</option></select></label>
    <fieldset disabled={busy} className="space-y-3"><legend className="sr-only">Data to delete</legend>{(['chats', 'training', 'knowledge'] as const).map((category) => {
      const row = rows?.find((item) => item.category === category);
      return <label key={category} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4"><input type="checkbox" checked={selected.includes(category)} onChange={(event) => onSelect(event.currentTarget.checked ? [...selected, category] : selected.filter((item) => item !== category))} className="mt-1 size-4 accent-primary" /><span className="min-w-0 flex-1"><span className="text-sm font-medium">{labels[category]}</span><span className="mt-1 block text-xs text-muted-foreground">{descriptions[category]}</span></span><span className="shrink-0 text-right text-xs text-muted-foreground">{row ? <>{row.count} files<br />{formatBytes(row.bytes)}</> : 'Calculating…'}</span></label>;
    })}</fieldset>
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{count} files selected · {formatBytes(bytes)} reclaimable</p><button type="button" disabled={busy || !preview || !count} onClick={onDelete} className={`${buttonClass} text-destructive`}>Delete selected data…</button></div>
  </div>;
}
