import { useEffect, useRef, useState } from 'react';
import { dreamingRequest, type DreamingDashboard, type DreamingDecision, type DreamingReport } from '@/lib/dreaming';
import { useProjectApi } from '@/lib/project-api';
import { ErrorNotice } from '@/components/ui';

const actionClass = 'min-h-11 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:cursor-default disabled:opacity-50';

export function DreamingPanel({ enabled }: { enabled: boolean }) {
  const { fetch: api } = useProjectApi();
  const [dashboard, setDashboard] = useState<DreamingDashboard>();
  const [report, setReport] = useState<DreamingReport>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const active = useRef(true);
  const writing = useRef(false);
  const selection = useRef(0);
  useEffect(() => {
    active.current = true;
    let current = true;
    setDashboard(undefined); setReport(undefined); setError(''); selection.current++;
    void dreamingRequest<DreamingDashboard>(api).then((value) => { if (current) setDashboard(value); })
      .catch((reason: unknown) => { if (current) setError(String(reason)); });
    return () => { current = false; active.current = false; selection.current++; };
  }, [api, retry]);
  const pending = enabled && dashboard?.jobs.some((job) => job.status === 'pending' || job.status === 'processing');
  useEffect(() => {
    if (!pending) return;
    let current = true;
    const timer = setInterval(() => {
      void dreamingRequest<DreamingDashboard>(api).then((value) => { if (current) setDashboard(value); })
        .catch((reason: unknown) => { if (current) setError(String(reason)); });
    }, 5_000);
    return () => { current = false; clearInterval(timer); };
  }, [api, pending]);
  const select = async (id: string) => {
    const revision = ++selection.current;
    setError('');
    try {
      const value = await dreamingRequest<DreamingReport>(api, `/${id}`);
      if (active.current && selection.current === revision) setReport(value);
    } catch (reason) { if (active.current && selection.current === revision) setError(String(reason)); }
  };
  const act = async (action?: DreamingDecision) => {
    if (writing.current) return;
    writing.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const value = await dreamingRequest<DreamingReport>(api, action && report ? `/${report.id}` : '', action ? { action } : {});
      if (!active.current) return;
      if (action) setReport(value);
      setNotice(action === 'apply' ? 'Applied. New chat turns use the consolidated knowledge.' : action === 'undo' ? 'Undone. Original knowledge is available again.' : action === 'dismiss' ? 'Report dismissed.' : 'Report queued. You can keep chatting while it runs.');
      // The decision is confirmed before refreshing, so a failed refresh does not erase success.
      const fresh = await dreamingRequest<DreamingDashboard>(api);
      if (active.current) setDashboard(fresh);
    } catch (reason) { if (active.current) setError(String(reason)); }
    finally { writing.current = false; if (active.current) setBusy(false); }
  };
  return <section className="space-y-4 border-t border-border pt-6" aria-labelledby="dreaming-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-2">
        <h3 id="dreaming-heading" className="text-lg font-semibold">Knowledge consolidation</h3>
        <p className="max-w-prose text-sm leading-6 text-muted-foreground">Connect related findings and combine overlapping notes. Review a report before applying it; original notes and source references are kept for undo.</p>
      </div>
      <div className="flex flex-wrap gap-2"><button type="button" className={actionClass} disabled={busy} onClick={() => setRetry((value) => value + 1)}>Refresh reports</button>
      <button type="button" className={actionClass} disabled={busy || !enabled || !dashboard?.canGenerate || Boolean(pending)} onClick={() => { void act(); }}>{busy && !report ? 'Queueing…' : 'Generate report'}</button></div>
    </div>
    {!enabled && <p className="text-sm text-muted-foreground">Enable learning and codebase knowledge to generate or apply reports. Existing reports remain readable.</p>}
    {enabled && dashboard && !dashboard.canGenerate && <p className="text-sm text-muted-foreground">A learning model and at least one knowledge category are needed to generate a report.</p>}
    {error && <ErrorNotice title="Could not update knowledge consolidation" detail={error} onRetry={() => setRetry((value) => value + 1)} />}
    <p role="status" className="text-sm text-muted-foreground">{notice || (pending ? 'Preparing a knowledge report…' : '')}</p>
    {!dashboard && !error && <p role="status" className="text-sm text-muted-foreground">Loading reports…</p>}
    {dashboard?.jobs.filter((job) => job.last_error).map((job) => <p key={job.job_id} role="alert" className="break-words text-sm text-destructive">{job.status === 'failed' ? 'Report generation failed.' : 'Report generation will retry.'} {job.last_error} Generate a new report after checking the learning model.</p>)}
    {dashboard && <DreamingReportList dashboard={dashboard} selectedId={report?.id} busy={busy} onSelect={(id) => { void select(id); }} />}
    {report && <DreamingReportView report={report} enabled={enabled} busy={busy} onDecision={(action) => { void act(action); }} />}
  </section>;
}
export function DreamingReportList({ dashboard, selectedId, busy, onSelect }: {
  dashboard: DreamingDashboard; selectedId?: string; busy: boolean; onSelect: (id: string) => void;
}) {
  if (!dashboard.reports.length) return <p className="text-sm leading-6 text-muted-foreground">No reports yet. Generate one after a few solved investigations have saved knowledge.</p>;
  return <ul className="divide-y divide-border" aria-label="Recent consolidation reports">
    {dashboard.reports.map((report) => <li key={report.id}>
      <button type="button" disabled={busy} onClick={() => onSelect(report.id)} aria-pressed={selectedId === report.id}
        className="flex min-h-11 w-full flex-wrap items-start justify-between gap-2 rounded-lg p-3 text-start text-sm hover:bg-accent disabled:opacity-50 aria-pressed:bg-accent">
        <span className="min-w-0 flex-1 break-words">{report.summary || 'Knowledge report'}<span className="mt-1 block text-xs text-muted-foreground">{new Date(report.created_at).toLocaleString()} · {report.considered} notes considered</span></span>
        <span className="capitalize text-muted-foreground">{report.status}</span>
      </button>
    </li>)}
  </ul>;
}
export function DreamingReportView({ report, enabled, busy, onDecision }: {
  report: DreamingReport; enabled: boolean; busy: boolean; onDecision: (action: DreamingDecision) => void;
}) {
  return <div className="min-w-0 space-y-4 border-t border-border pt-4">
    <h4 className="break-words text-base font-semibold">{report.summary || 'Knowledge report'}</h4>
    {report.omitted > 0 && <p className="text-sm leading-6 text-muted-foreground">{report.omitted} notes were outside this pass’s size limit. This report covers {report.considered} notes.</p>}
    {!report.changes.length && <p className="text-sm text-muted-foreground">No changes proposed. Existing knowledge stays as it is.</p>}
    {report.changes.map((change) => <details key={change.before.id} className="border-b border-border pb-3">
      <summary className="min-h-11 cursor-pointer break-words py-3 text-sm font-medium">{change.before.title} — {change.after.status === 'archived' ? 'Archive duplicate' : 'Update knowledge'}</summary>
      <p className="mb-3 break-words text-sm leading-6 text-muted-foreground">{change.reason}</p>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {[['Before', change.before], ['After', change.after]] .map(([label, value]) => {
          const artifact = value as typeof change.before;
          return <div key={String(label)} className="min-w-0"><h5 className="mb-2 text-sm font-medium">{String(label)}</h5><pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs leading-5">{artifact.body}</pre><p className="mt-2 break-words text-xs leading-5 text-muted-foreground">{artifact.source_interactions.length} source investigations · {artifact.claims?.length ?? 0} claims{artifact.related_ids?.length ? ` · ${artifact.related_ids.length} related notes` : ''}{artifact.merged_into ? ` · Combined into ${artifact.merged_into}` : ''}</p>{artifact.related_ids?.length ? <p className="mt-1 break-words text-xs text-muted-foreground">Related: {artifact.related_ids.join(', ')}</p> : null}</div>;
        })}
      </div>
    </details>)}
    {report.status === 'applied' && <p className="text-sm leading-6 text-muted-foreground">Applied views are used while their source notes and evidence remain current. Later source changes can make this report inactive. Undo keeps any newer findings.</p>}
    <div className="flex flex-wrap gap-2">
      {report.status === 'proposed' && <><button type="button" className={actionClass} disabled={busy || !enabled || !report.changes.length} onClick={() => onDecision('apply')}>Apply report</button><button type="button" className={actionClass} disabled={busy || !enabled} onClick={() => onDecision('dismiss')}>Dismiss report</button></>}
      {report.status === 'applied' && <button type="button" className={actionClass} disabled={busy || !enabled} onClick={() => onDecision('undo')}>Undo report</button>}
    </div>
  </div>;
}
