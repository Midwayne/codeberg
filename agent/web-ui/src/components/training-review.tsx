import { ArrowRight, Check, CircleHelp, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  KIND_LABELS, exampleAnswer, loadReviewExample, loadTrainingReview, proposedEvidence, submitReview,
  type EvidencePreview, type ReviewDashboard, type ReviewExample, type ReviewSummary,
} from '@/lib/training';

type Filter = 'ready' | 'reviewed' | 'stale';
type Decision = 'training' | 'eval' | 'dismiss';

export function TrainingReview() {
  const [dashboard, setDashboard] = useState<ReviewDashboard>();
  const [selectedId, setSelectedId] = useState<string>();
  const [example, setExample] = useState<ReviewExample>();
  const [filter, setFilter] = useState<Filter>('ready');
  const [destination, setDestination] = useState<'training' | 'eval'>('training');
  const [verified, setVerified] = useState<string[]>([]);
  const [otherPaths, setOtherPaths] = useState('');
  const [expected, setExpected] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh(): Promise<void> {
    const next = await loadTrainingReview();
    setDashboard(next);
    setSelectedId((current) => current && next.candidates.some((row) => row.id === current && row.state === 'ready')
      ? current : next.candidates.find((row) => row.state === 'ready')?.id);
  }

  useEffect(() => {
    let active = true;
    void loadTrainingReview().then((next) => {
      if (!active) return;
      setDashboard(next);
      setSelectedId(next.candidates.find((row) => row.state === 'ready')?.id);
    }).catch((failure: unknown) => { if (active) setError(String(failure)); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setExample(undefined);
    setVerified([]);
    setOtherPaths('');
    setExpected('');
    setDestination('training');
    setError('');
    if (selectedId) void loadReviewExample(selectedId).then((value) => {
      if (active) setExample(value);
    }).catch((failure: unknown) => { if (active) setError(String(failure)); });
    return () => { active = false; };
  }, [selectedId]);

  const visible = dashboard?.candidates.filter((row) => filter === 'ready' ? row.state === 'ready'
    : filter === 'stale' ? row.state === 'stale' : ['training', 'eval', 'dismissed'].includes(row.state)) ?? [];
  const selected = dashboard?.candidates.find((row) => row.id === selectedId);

  async function decide(decision: Decision): Promise<void> {
    if (!selected || busy) return;
    setError('');
    const paths = [...new Set([...verified, ...otherPaths.split(/[\n,]/).map((value) => value.trim()).filter(Boolean)])];
    let oracle: Record<string, unknown> | undefined;
    if (decision === 'eval') {
      if (selected.kind === 'retrieval' && !paths.length) {
        setError('Choose or enter at least one independently checked source file.');
        return;
      }
      if (!paths.length && !expected.trim()) {
        setError('Record the checked outcome or source evidence for this evaluation case.');
        return;
      }
      oracle = { ...(paths.length ? { files: paths } : {}), ...(expected.trim() ? { notes: expected.trim() } : {}) };
    }
    if (decision === 'training' && selected.kind === 'hard_negative_candidates') {
      if (!paths.length) {
        setError('Confirm at least one genuinely incorrect result before adding it to training.');
        return;
      }
      oracle = { verified_negatives: paths };
    }
    setBusy(true);
    try {
      await submitReview(selected.id, decision, oracle);
      const nextId = dashboard?.candidates.filter((row) => row.state === 'ready' && row.id !== selected.id)
        .find((row) => row.id !== selected.id)?.id;
      await refresh();
      setFilter('ready');
      if (nextId) setSelectedId(nextId);
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
    }
  }

  function nextExample(): void {
    if (!selectedId) return;
    const ready = dashboard?.candidates.filter((row) => row.state === 'ready') ?? [];
    setSelectedId(ready[(ready.findIndex((row) => row.id === selectedId) + 1) % ready.length]?.id);
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background" aria-label="Training review">
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:py-9">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">Learning data</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Training review</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Check an example, then decide whether it belongs in training or a held-out evaluation set. Approval saves data for later use; it does not retrain the current model.</p>
          </div>
          <button type="button" onClick={() => void refresh().catch((failure: unknown) => setError(String(failure)))}
            aria-label="Refresh training data" title="Refresh" className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-accent hover:text-foreground">
            <RefreshCw className="size-4" />
          </button>
        </div>

        {dashboard ? <TrainingSummary stats={dashboard.stats} /> : !error ? <p className="text-sm text-muted-foreground">Loading training data…</p> : null}
        {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</p>}

        {dashboard && (
          <div className="grid min-h-[34rem] gap-4 lg:grid-cols-[minmax(16rem,21rem)_minmax(0,1fr)]">
            <section className="flex min-h-0 flex-col rounded-xl border border-border bg-card" aria-label="Examples">
              <div className="border-b border-border p-3">
                <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1 text-xs">
                  {([
                    ['ready', `To review · ${dashboard.stats.ready}`],
                    ['reviewed', `Reviewed · ${dashboard.stats.training + dashboard.stats.eval + dashboard.stats.dismissed}`],
                    ['stale', `Outdated · ${dashboard.stats.stale}`],
                  ] as const).map(([key, label]) => <button key={key} type="button" onClick={() => {
                    setFilter(key);
                    setSelectedId(dashboard.candidates.find((row) => key === 'ready' ? row.state === 'ready'
                      : key === 'stale' ? row.state === 'stale' : ['training', 'eval', 'dismissed'].includes(row.state))?.id);
                  }}
                    aria-pressed={filter === key} className={`rounded-md px-2 py-2 font-medium transition-colors ${filter === key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>)}
                </div>
              </div>
              <div className="max-h-[45rem] min-h-0 flex-1 overflow-y-auto p-2">
                {visible.length ? visible.map((row) => (
                  <button key={row.id} type="button" onClick={() => setSelectedId(row.id)}
                    aria-pressed={selectedId === row.id} className={`mb-1 w-full rounded-lg border px-3 py-3 text-left transition-colors ${selectedId === row.id ? 'border-foreground/30 bg-accent' : 'border-transparent hover:bg-muted'}`}>
                    <span className="text-[11px] font-medium text-muted-foreground">{KIND_LABELS[row.kind]} · {row.repositories.join(', ') || 'No repository'}</span>
                    <span className="mt-1 block line-clamp-2 text-sm font-medium">{row.query}</span>
                    <span className="mt-1 block text-[11px] text-muted-foreground">{row.state === 'ready' ? 'Ready for review' : row.state === 'stale' ? 'Outdated revision' : row.state === 'eval' ? 'Evaluation' : row.state === 'training' ? 'Training' : 'Set aside'}</span>
                  </button>
                )) : <p className="px-3 py-8 text-center text-sm text-muted-foreground">{filter === 'ready' ? 'All caught up. New examples appear after answered or graded chats.' : 'Nothing here yet.'}</p>}
              </div>
            </section>

            <section className="min-w-0 rounded-xl border border-border bg-card" aria-label="Example details">
              {selected && example?.id === selected.id ? (
                <ReviewDetail row={selected} example={example} destination={destination} onDestination={setDestination}
                  verified={verified} onVerified={(path) => setVerified((current) => current.includes(path) ? current.filter((item) => item !== path) : [...current, path])}
                  otherPaths={otherPaths} onOtherPaths={setOtherPaths} expected={expected} onExpected={setExpected}
                  saving={busy} onDecide={(decision) => void decide(decision)} onNext={nextExample} />
              ) : <div className="flex h-full min-h-64 items-center justify-center px-6 text-center text-sm text-muted-foreground">
                {selected ? 'Loading example…' : 'Select an example to inspect its answer and evidence.'}
              </div>}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

export function TrainingSummary({ stats }: { stats: ReviewDashboard['stats'] }) {
  const reviewed = stats.training + stats.eval + stats.dismissed;
  const current = reviewed + stats.ready;
  const progress = current ? Math.round(100 * reviewed / current) : 0;
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5" aria-label="Training progress">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Review progress</p>
          <p className="text-xs text-muted-foreground">{reviewed} of {current} current examples reviewed · {stats.stale} outdated revisions excluded</p>
        </div>
        <span className="text-lg font-semibold tabular-nums">{progress}%</span>
      </div>
      <div role="progressbar" aria-label="Review progress" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}
        className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-foreground transition-all" style={{ width: `${progress}%` }} />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([
          ['To review', stats.ready, 'Awaiting your decision'],
          ['Training', stats.training, 'Approved examples'],
          ['Evaluation', stats.eval, 'Held-out checks'],
          ['Set aside', stats.dismissed, 'Not selected'],
        ] as const).map(([label, value, caption]) => (
          <div key={label} className="rounded-lg bg-muted/70 px-3 py-3">
            <p className="text-2xl font-semibold tabular-nums">{value}</p>
            <p className="text-xs font-medium">{label}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{caption}</p>
          </div>
        ))}
      </div>
      {stats.ready > 0 && <p className="mt-4 text-xs text-muted-foreground">In the queue: {Object.entries(stats.by_kind)
        .map(([kind, count]) => `${count} ${KIND_LABELS[kind as keyof typeof KIND_LABELS]?.toLowerCase() ?? kind}`).join(' · ')}</p>}
    </section>
  );
}

export function ReviewDetail({ row, example, destination, onDestination, verified, onVerified, otherPaths, onOtherPaths,
  expected, onExpected, saving, onDecide, onNext }: {
  row: ReviewSummary;
  example: ReviewExample;
  destination: 'training' | 'eval';
  onDestination: (value: 'training' | 'eval') => void;
  verified: string[];
  onVerified: (path: string) => void;
  otherPaths: string;
  onOtherPaths: (value: string) => void;
  expected: string;
  onExpected: (value: string) => void;
  saving: boolean;
  onDecide: (decision: Decision) => void;
  onNext: () => void;
}) {
  const answer = exampleAnswer(example);
  const evidence = proposedEvidence(example, 'proposed_evidence');
  const positive = proposedEvidence(example, 'positive');
  const negatives = proposedEvidence(example, 'proposed_negatives');
  const hardNegatives = proposedEvidence(example, 'hard_negatives');
  const verifier = example.payload.verifier;
  const verifierFiles: EvidencePreview[] = verifier && typeof verifier === 'object' && 'proposed_files' in verifier && Array.isArray(verifier.proposed_files)
    ? verifier.proposed_files.filter((path): path is string => typeof path === 'string').map((path) => ({ path })) : [];
  const choices = destination === 'training' && row.kind === 'hard_negative_candidates' ? negatives :
    evidence.length ? evidence : positive.length ? positive : verifierFiles;
  const feedback = example.feedback.at(-1);
  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="rounded-full bg-muted px-2.5 py-1 font-medium text-foreground">{KIND_LABELS[row.kind]}</span>
        <span>{row.repositories.join(', ') || 'No repository'} · {new Date(row.extracted_at).toLocaleDateString()}</span>
      </div>
      <div>
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Question</p>
        <h2 className="mt-1 text-lg font-semibold leading-snug">{row.query}</h2>
      </div>
      {answer && <div>
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Answer to review</p>
        <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-border bg-background p-3 text-sm whitespace-pre-wrap wrap-break-word">{answer}</div>
      </div>}
      {typeof example.payload.rejected === 'string' && <div>
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Earlier answer that was rejected</p>
        <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-border bg-muted/50 p-3 text-sm whitespace-pre-wrap wrap-break-word">{example.payload.rejected}</div>
      </div>}
      {feedback && <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
        <span className="font-medium">User feedback: {feedback.label.replaceAll('_', ' ')}</span>
        {feedback.reason && <p className="mt-1 text-muted-foreground">{feedback.reason}</p>}
      </div>}
      {row.proposed_files.length > 0 && <div>
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Evidence to check</p>
        <div className="mt-2 space-y-2">
          {[...evidence, ...positive, ...negatives, ...hardNegatives, ...verifierFiles].slice(0, 12).map((hit, index) => (
            <div key={`${hit.path}-${index}`} className="rounded-lg border border-border p-3 text-xs">
              <span className="font-mono wrap-break-word">{hit.path}</span>
              {hit.snippet && <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-muted-foreground">{hit.snippet}</p>}
            </div>
          ))}
        </div>
      </div>}

      {row.state === 'ready' ? <div className="space-y-4 border-t border-border pt-5">
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1 text-sm">
          <button type="button" onClick={() => onDestination('training')} aria-pressed={destination === 'training'}
            className={`rounded-md px-3 py-2 font-medium ${destination === 'training' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>Teach the agent</button>
          <button type="button" onClick={() => onDestination('eval')} aria-pressed={destination === 'eval'}
            className={`rounded-md px-3 py-2 font-medium ${destination === 'eval' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>Test the agent</button>
        </div>
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          {destination === 'training' ? <Sparkles className="mt-0.5 size-4 shrink-0" /> : <ShieldCheck className="mt-0.5 size-4 shrink-0" />}
          {destination === 'training' ? 'Training teaches future answers. Approve only if the answer and evidence look right.' : 'Evaluation is held out to measure quality. Check the expected outcome independently before saving it.'}
        </p>
        {(destination === 'eval' || row.kind === 'hard_negative_candidates') && <div className="space-y-3 rounded-lg border border-border p-3">
          <p className="text-xs font-medium">{row.kind === 'hard_negative_candidates' && destination === 'training' ? 'Which proposed results did you verify are wrong?' : 'Which sources did you independently verify?'}</p>
          {choices.map((hit) => <label key={hit.path} className="flex cursor-pointer items-start gap-2 text-xs">
            <input type="checkbox" checked={verified.includes(hit.path)} onChange={() => onVerified(hit.path)} className="mt-0.5 accent-foreground" />
            <span className="font-mono wrap-break-word">{hit.path}</span>
          </label>)}
          {destination === 'eval' && <label className="block text-xs text-muted-foreground">
            Other verified files (one per line, optional)
            <textarea value={otherPaths} onChange={(event) => onOtherPaths(event.currentTarget.value)} rows={2}
              placeholder="src/path/to/verified-file.ts" className="mt-1 w-full rounded-md border border-border bg-background p-2 font-mono text-xs text-foreground" />
          </label>}
          {destination === 'eval' && row.kind !== 'retrieval' && <label className="block text-xs text-muted-foreground">
            Checked expected outcome (if no file applies)
            <textarea value={expected} onChange={(event) => onExpected(event.currentTarget.value)} rows={2}
              placeholder="What should a correct result say?" className="mt-1 w-full rounded-md border border-border bg-background p-2 text-xs text-foreground" />
          </label>}
        </div>}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={saving} onClick={() => onDecide(destination)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            <Check className="size-4" /> {saving ? 'Saving…' : destination === 'training' ? 'Add to training' : 'Save evaluation case'}
          </button>
          <button type="button" disabled={saving} onClick={() => onDecide('dismiss')} className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted">Set aside</button>
          <button type="button" disabled={saving} onClick={onNext} className="ml-auto inline-flex items-center gap-1 px-2 py-2 text-sm text-muted-foreground hover:text-foreground">Next <ArrowRight className="size-4" /></button>
        </div>
      </div> : <p className="flex items-center gap-2 border-t border-border pt-4 text-sm text-muted-foreground">
        <CircleHelp className="size-4" /> {row.state === 'stale' ? 'This example is outdated after newer feedback. It cannot be approved.' : row.state === 'dismissed' ? 'You set this example aside.' : `Approved for ${row.state === 'eval' ? 'evaluation' : 'training'}.`}
      </p>}
      <details className="border-t border-border pt-4 text-xs text-muted-foreground">
        <summary className="cursor-pointer">Technical record</summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-muted p-3 whitespace-pre-wrap wrap-break-word">{JSON.stringify(example.payload, null, 2)}</pre>
      </details>
    </div>
  );
}
