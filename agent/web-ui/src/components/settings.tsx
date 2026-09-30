import { Activity, ArrowLeft, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  cleanupResources, formatBytes, loadResourceUsage, previewCleanup,
  type CleanupCategory, type CleanupPreview, type ResourceSample, type ResourceUsage,
} from '@/lib/resources';

const labels: Record<CleanupCategory, string> = { chats: 'Saved chats', training: 'Training data', knowledge: 'Knowledge documents' };
const descriptions: Record<CleanupCategory, string> = {
  chats: 'Saved conversations, including archived chats. Pinned chats are kept.',
  training: 'Candidates and their training, evaluation, and dismissed copies. Recently reviewed examples are kept together.',
  knowledge: 'Generated service, flow, concept, and debugging documents. Original repository files are kept.',
};
const buttonClass = 'rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50';

export function Settings({ onClose, onModels }: { onClose: () => void; onModels: () => void }) {
  const [section, setSection] = useState<'usage' | 'cleanup'>('usage');
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
          <button type="button" onClick={onModels} className={`${buttonClass} flex items-center gap-2`}><SlidersHorizontal className="size-4" />Model settings</button>
        </div>
        <nav aria-label="Settings sections" className="flex flex-wrap gap-2 border-b border-border pb-4">
          <button type="button" onClick={() => setSection('usage')} aria-current={section === 'usage' ? 'page' : undefined} className={`${buttonClass} flex items-center gap-2 ${section === 'usage' ? 'bg-accent' : ''}`}><Activity className="size-4" />Resource usage</button>
          <button type="button" onClick={() => setSection('cleanup')} aria-current={section === 'cleanup' ? 'page' : undefined} className={`${buttonClass} flex items-center gap-2 ${section === 'cleanup' ? 'bg-accent' : ''}`}><Trash2 className="size-4" />Free up resources</button>
        </nav>
        {section === 'usage' ? <ResourceUsagePanel /> : <CleanupPanel />}
      </div>
    </main>
  );
}

function ResourceUsagePanel() {
  const [usage, setUsage] = useState<ResourceUsage>();
  const [error, setError] = useState('');
  const [range, setRange] = useState(60);
  useEffect(() => {
    let active = true;
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try { const value = await loadResourceUsage(); if (active) { setUsage(value); setError(''); } }
      catch (failure) { if (active) setError(String(failure)); }
      finally { loading = false; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 10_000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return <>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {usage ? <ResourceUsageView usage={usage} range={range} onRange={setRange} /> : <p role="status" className="text-sm text-muted-foreground">Loading resource usage…</p>}
  </>;
}

export function ResourceUsageView({ usage, range, onRange }: { usage: ResourceUsage; range: number; onRange: (value: number) => void }) {
  const current = usage.current;
  const percent = (used: number, total: number) => total > 0 ? used / total * 100 : 0;
  const memoryPercent = (row: ResourceSample) => percent(row.memory.usedBytes, row.memory.totalBytes);
  const diskPercent = (row: ResourceSample) => row.disk ? percent(row.disk.usedBytes, row.disk.totalBytes) : 0;
  const rows = usage.history.filter((row) => row.timestamp >= (current?.timestamp ?? Date.now()) - range * 60_000);
  return <section className="space-y-5" aria-label="Resource usage">
    <div><h2 className="text-lg font-semibold">Resource usage</h2><p className="mt-1 text-sm text-muted-foreground">Live usage on the machine running Codeberg. Samples every 10 seconds; one hour of history is kept while the web server runs.</p></div>
    <div className="grid gap-3 sm:grid-cols-3">
      <Metric label="Host CPU" value={current ? `${current.cpu.hostPercent.toFixed(1)}%` : '—'} detail={current ? `${current.cpu.cores} CPU cores` : 'Waiting for first sample'} />
      <Metric label="Host memory" value={current ? `${memoryPercent(current).toFixed(1)}%` : '—'} detail={current ? `${formatBytes(current.memory.usedBytes)} / ${formatBytes(current.memory.totalBytes)}` : 'Waiting for first sample'} />
      <Metric label="Disk usage" value={current?.disk ? `${diskPercent(current).toFixed(1)}%` : '—'} detail={current?.disk ? `${formatBytes(current.disk.availableBytes)} available on the data volume` : 'Disk metrics unavailable'} />
    </div>
    <div className="rounded-xl border border-border p-4 text-sm">
      <h3 className="font-medium">Web server</h3>
      <p className="mt-2 text-muted-foreground">CPU: {current ? `${current.cpu.processPercent.toFixed(1)}%` : '—'} · Memory: {current ? formatBytes(current.memory.processBytes) : '—'} · Codeberg data on disk: {current?.disk ? formatBytes(current.disk.codebergBytes) : '—'}</p>
      <p className="mt-2 text-xs text-muted-foreground">Process metrics cover the web server and its learning worker. CPU 100% equals one full core. Host metrics include all processes; disk totals cover the volume containing CODEBERG_HOME. Data size is refreshed once a minute.</p>
    </div>
    <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium">Usage history</h3><label className="text-sm">Time range <select value={range} onChange={(event) => onRange(Number(event.currentTarget.value))} className="ml-2 rounded-md border border-border bg-background px-2 py-1"><option value={5}>5 minutes</option><option value={15}>15 minutes</option><option value={60}>1 hour</option></select></label></div>
    <div className="grid gap-3 sm:grid-cols-3">
      <UsageChart title="Host CPU history" rows={rows} value={(row) => row.cpu.hostPercent} range={range} />
      <UsageChart title="Host memory history" rows={rows} value={memoryPercent} range={range} />
      <UsageChart title="Disk usage history" rows={rows.filter((row) => row.disk)} value={diskPercent} range={range} />
    </div>
    {current && <p className="text-xs text-muted-foreground">Last sampled {new Date(current.timestamp).toLocaleTimeString()}. History resets when the web server restarts.</p>}
  </section>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded-xl border border-border p-4"><h3 className="text-sm text-muted-foreground">{label}</h3><p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>;
}

function UsageChart({ title, rows, value, range }: { title: string; rows: ResourceSample[]; value: (row: ResourceSample) => number; range: number }) {
  const end = rows.at(-1)?.timestamp ?? Date.now();
  const start = end - range * 60_000;
  const first = rows[0];
  const points = rows.map((row) => `${(row.timestamp - start) / (end - start) * 300},${100 - Math.min(100, Math.max(0, value(row)))}`).join(' ');
  return <figure className="rounded-xl border border-border p-3"><figcaption className="mb-3 text-xs font-medium">{title}</figcaption>
    {first ? <><svg viewBox="0 -4 300 108" role="img" aria-label={`${title}, 0 to 100 percent`} className="h-28 w-full text-primary"><path d="M0 0H300 M0 50H300 M0 100H300" className="stroke-border" fill="none" /><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />{rows.length === 1 && <circle cx="300" cy={100 - value(first)} r="3" fill="currentColor" />}</svg><div className="flex justify-between text-[10px] text-muted-foreground"><span>{range} min ago</span><span>0–100% · now</span></div></> : <p className="flex h-28 items-center justify-center text-xs text-muted-foreground">No samples yet</p>}
  </figure>;
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
    {confirming && <div className="space-y-3 rounded-xl border border-destructive p-4"><p className="text-sm">Permanently delete {count} matching files from {selected.map((category) => labels[category]).join(', ')}? This cannot be undone.</p><div className="flex gap-2"><button type="button" disabled={busy} onClick={() => void remove()} className="rounded-lg bg-destructive px-3 py-2 text-sm text-white disabled:opacity-50">{busy ? 'Deleting…' : 'Confirm deletion'}</button><button type="button" disabled={busy} onClick={() => setConfirming(false)} className={buttonClass}>Cancel</button></div></div>}
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
