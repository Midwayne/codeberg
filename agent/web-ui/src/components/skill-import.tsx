import { FileText, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { prepareSkillFiles, type SkillFile } from '@/lib/skill-files';

const button = 'min-h-11 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50';

export function SkillImport({ api, scope, scopeLabel, onImported, onBusyChange }: {
  api: typeof fetch; scope: string; scopeLabel: string; onImported: () => void; onBusyChange: (busy: boolean) => void;
}) {
  const [files, setFiles] = useState<SkillFile[]>([]);
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(''); const [saved, setSaved] = useState('');
  const input = useRef<HTMLInputElement>(null); const action = useRef<AbortController | null>(null);
  const depth = useRef(0);
  useEffect(() => () => { action.current?.abort(); onBusyChange(false); }, [onBusyChange]);

  async function preview(selected: File[]) {
    if (action.current) return;
    const controller = new AbortController(); action.current = controller;
    setBusy('preview'); onBusyChange(true); setError(''); setSaved(''); setFiles([]);
    try {
      const prepared = await prepareSkillFiles(selected);
      const readable = prepared.filter((file) => !file.error);
      let results: SkillFile[] = [];
      if (readable.length) {
        const response = await api('/api/extensions/skills/preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: readable }), signal: controller.signal,
        });
        if (!response.ok) throw new Error(await response.text());
        results = (await response.json() as { files: SkillFile[] }).files;
      }
      let index = 0;
      if (!controller.signal.aborted) setFiles(prepared.map((file) => file.error ? file : { ...file, ...results[index++] }));
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { action.current = null; if (!controller.signal.aborted) { setBusy(null); onBusyChange(false); } }
  }

  async function importFiles() {
    if (action.current) return;
    const controller = new AbortController(); action.current = controller;
    setBusy('import'); onBusyChange(true); setError(''); setSaved('');
    const remaining: SkillFile[] = []; let imported = 0;
    try {
      for (const file of files) {
        if (controller.signal.aborted) return;
        if (file.error || !file.name || file.content === undefined) { remaining.push(file); continue; }
        try {
          const response = await api('/api/extensions', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: 'skill', scope, name: file.name, content: file.content }), signal: controller.signal,
          });
          if (!response.ok) throw new Error(await response.text());
          imported++;
        } catch (reason) {
          if (controller.signal.aborted) return;
          remaining.push({ ...file, importError: reason instanceof Error ? reason.message : String(reason) });
        }
      }
      if (!controller.signal.aborted) {
        setFiles(remaining);
        if (imported) { setSaved(`${imported} ${imported === 1 ? 'skill' : 'skills'} imported into ${scopeLabel}. Available on the next chat turn.`); onImported(); }
      }
    } finally { action.current = null; if (!controller.signal.aborted) { setBusy(null); onBusyChange(false); } }
  }
  const ready = files.filter((file) => !file.error && file.name && file.content !== undefined).length;
  return <section aria-label="Import skill files" className="space-y-3">
    <h3 className="text-sm font-medium">Import skill files</h3>
    <div onDragEnter={(event) => { event.preventDefault(); if (!busy && event.dataTransfer.types.includes('Files')) { depth.current++; setDragging(true); } }}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = busy ? 'none' : 'copy'; }}
      onDragLeave={(event) => { event.preventDefault(); depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }}
      onDrop={(event) => { event.preventDefault(); depth.current = 0; setDragging(false); if (!busy) void preview(Array.from(event.dataTransfer.files)); }}
      className={`rounded-xl border border-dashed p-4 sm:p-5 ${dragging ? 'border-ring bg-accent' : 'border-border'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><Upload aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" /><div><p className="text-sm font-medium">{busy === 'preview' ? 'Reading skill files…' : dragging ? 'Drop to preview skills' : 'Drop skill files here'}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">SKILL.md or other .md files · up to 20 files, 256 KB each</p></div></div><button type="button" disabled={Boolean(busy)} onClick={() => input.current?.click()} className={button}>Choose skill files</button></div>
      <input ref={input} type="file" aria-label="Skill files" accept=".md,text/markdown" multiple hidden onChange={(event) => { const selected = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; if (selected.length) void preview(selected); }} />
    </div>
    {files.length > 0 && <div className="space-y-3"><p className="text-sm text-muted-foreground">Review files before importing into {scopeLabel}.</p><ul className="divide-y divide-border">{files.map((file, index) => <li key={`${index}:${file.filename}`} className="flex items-start gap-3 py-3"><FileText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{file.name ?? file.filename}</p>{file.name && <p className="mt-1 break-words text-xs text-muted-foreground">{file.filename}</p>}{file.description && <p className="mt-1 break-words text-sm text-muted-foreground">{file.description}</p>}{(file.error || file.importError) && <p role="alert" className="mt-1 break-words text-sm text-destructive">{file.error ?? file.importError}</p>}</div><button type="button" aria-label={`Remove ${file.name ?? file.filename}`} disabled={Boolean(busy)} onClick={() => setFiles((current) => current.filter((_, i) => i !== index))} className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"><X className="size-4" /></button></li>)}</ul><button type="button" disabled={Boolean(busy) || !ready} onClick={() => void importFiles()} className={`${button} bg-primary text-primary-foreground hover:bg-primary/90`}>{busy === 'import' ? 'Importing…' : `Import ${ready} ${ready === 1 ? 'skill' : 'skills'}`}</button></div>}
    {busy && <p role="status" className="text-sm text-muted-foreground">{busy === 'preview' ? 'Preparing a preview. Files have not been imported.' : 'Importing selected skills…'}</p>}
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {saved && <p role="status" className="text-sm">{saved}</p>}
  </section>;
}
