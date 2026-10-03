import { ArrowLeft, ArrowRight, Check, CircleHelp, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import {
  KIND_LABELS, exampleAnswer, proposedEvidence,
  type EvidencePreview, type ReviewDashboard, type ReviewExample, type ReviewSummary,
} from '@/lib/training';
import { prepareReviewDecision, type ReviewDecision } from '@/lib/training-review';
import { useTrainingReview } from '@/lib/use-training-review';
import { useMediaQuery } from '@/lib/use-media-query';
import { ErrorNotice, IconButton } from '@/components/ui';

type Decision = ReviewDecision;

export function TrainingReview() {
  const review = useTrainingReview();
  const { dashboard, filter, visible, selected, selectedId, example, saving } = review;
  const [destination, setDestination] = useState<'training' | 'eval'>('training');
  const [verified, setVerified] = useState<string[]>([]);
  const [otherPaths, setOtherPaths] = useState('');
  const [expected, setExpected] = useState('');
  const [validationError, setValidationError] = useState('');
  const [mobileDetails, setMobileDetails] = useState(false);
  const desktop = useMediaQuery('(min-width: 1024px)');
  const titleRef = useRef<HTMLHeadingElement>(null);
  const queueRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const locked = saving || review.loading;

  useEffect(() => { titleRef.current?.focus(); }, []);
  useEffect(() => {
    setVerified([]);
    setOtherPaths('');
    setExpected('');
    setDestination('training');
    setValidationError('');
  }, [selectedId]);
  useEffect(() => {
    if (!mobileDetails || desktop) return;
    detailRef.current?.focus();
    detailRef.current?.scrollIntoView({ block: 'start' });
  }, [mobileDetails, selectedId, desktop]);

  function select(id: string): void {
    if (locked) return;
    review.select(id);
    setMobileDetails(true);
  }
  function nextExample(): void {
    const index = visible.findIndex((row) => row.id === selectedId);
    const next = visible[(index + 1) % visible.length];
    if (next) select(next.id);
  }
  function backToExamples(): void {
    setMobileDetails(false);
    requestAnimationFrame(() => {
      queueRef.current?.focus();
      queueRef.current?.scrollIntoView({ block: 'start' });
    });
  }
  function decide(decision: Decision): void {
    if (!selected || example?.id !== selected.id || locked) return;
    const result = prepareReviewDecision(selected, decision, { verified, otherPaths, expected },
      proposedEvidence(example, 'proposed_negatives').map((hit) => hit.path));
    setValidationError(result.ok ? '' : result.error);
    if (result.ok) void review.save(decision, result.oracle);
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background" aria-label="Training review">
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:py-9">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 ref={titleRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight">Training review</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Check an example, then decide whether it belongs in training or a held-out evaluation set. Approval saves data for later use; it does not retrain the current model.</p>
          </div>
          <IconButton onClick={review.refresh} disabled={locked} aria-label="Refresh training data" title="Refresh training data">
            <RefreshCw className="size-4" />
          </IconButton>
        </div>

        {dashboard && <TrainingSummary stats={dashboard.stats} />}
        {review.loading && <p role="status" className="text-sm text-muted-foreground">{dashboard ? 'Refreshing training data…' : 'Loading training data…'}</p>}
        {review.dashboardError && <ErrorNotice title={dashboard ? 'Could not refresh training data' : 'Could not load training data'} detail={review.dashboardError} onRetry={review.refresh} />}
        {review.announcement && <p role="status" className="text-sm text-foreground">{review.announcement}</p>}

        {dashboard && (
          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(16rem,21rem)_minmax(0,1fr)]">
            <section ref={queueRef} tabIndex={-1} className={`min-h-0 min-w-0 flex-col rounded-xl border border-border bg-card ${mobileDetails ? 'hidden lg:flex' : 'flex'}`} aria-label="Examples">
              <div className="border-b border-border p-3">
                <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1 text-xs" aria-label="Example filters">
                  {([
                    ['ready', `To review · ${dashboard.stats.ready}`],
                    ['reviewed', `Reviewed · ${dashboard.stats.training + dashboard.stats.eval + dashboard.stats.dismissed}`],
                    ['stale', `Outdated · ${dashboard.stats.stale}`],
                  ] as const).map(([key, label]) => <button key={key} type="button" disabled={locked}
                    onClick={() => { review.setFilter(key); setValidationError(''); }}
                    aria-pressed={filter === key} className={`min-h-11 rounded-md px-1 py-2 font-medium transition-colors disabled:opacity-50 ${filter === key ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>)}
                </div>
              </div>
              <div className="max-h-[45rem] min-h-0 flex-1 overflow-y-auto p-2">
                {visible.length ? visible.map((row) => (
                  <button key={row.id} type="button" disabled={locked} onClick={() => select(row.id)} aria-controls="training-example"
                    aria-pressed={selectedId === row.id} className={`mb-1 w-full rounded-lg border px-3 py-3 text-left transition-colors disabled:opacity-50 ${selectedId === row.id ? 'border-primary/40 bg-accent' : 'border-transparent hover:bg-muted'}`}>
                    <span className="block break-words text-xs leading-5 text-muted-foreground">{KIND_LABELS[row.kind]} · {row.repositories.join(', ') || 'No repository'}</span>
                    <span className="mt-1 block line-clamp-2 break-words text-sm font-medium">{row.query}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{row.state === 'ready' ? 'Ready for review' : row.state === 'stale' ? 'Outdated revision' : row.state === 'eval' ? 'Evaluation' : row.state === 'training' ? 'Training' : 'Set aside'}</span>
                  </button>
                )) : <p className="px-3 py-8 text-center text-sm text-muted-foreground">{filter === 'ready' ? 'All caught up. New examples appear after answered or graded chats.' : 'Nothing here yet.'}</p>}
              </div>
            </section>

            <section id="training-example" ref={detailRef} tabIndex={-1} aria-busy={!!selected && !example && !review.detailError}
              className={`min-w-0 scroll-mt-4 rounded-xl border border-border bg-card ${mobileDetails ? 'block' : 'hidden lg:block'}`} aria-label="Example details">
              <div className="border-b border-border p-2 lg:hidden"><button type="button" disabled={saving} onClick={backToExamples}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm hover:bg-accent disabled:opacity-50"><ArrowLeft className="size-4" />Back to examples</button></div>
              {review.detailError ? <div className="p-4"><ErrorNotice title="Could not load this example" detail={review.detailError} onRetry={review.retryDetail} /></div>
                : selected && example?.id === selected.id ? (
                <ReviewDetail row={selected} example={example} destination={destination} onDestination={(value) => { setDestination(value); setVerified([]); setValidationError(''); }}
                  verified={verified} onVerified={(path) => { setVerified((current) => current.includes(path) ? current.filter((item) => item !== path) : [...current, path]); setValidationError(''); }}
                  otherPaths={otherPaths} onOtherPaths={setOtherPaths} expected={expected} onExpected={setExpected}
                  saving={locked} error={validationError || review.saveError} canNext={visible.length > 1}
                  onDecide={decide} onNext={nextExample} />
              ) : <div role={selected ? 'status' : undefined} className="flex min-h-64 items-center justify-center px-6 text-center text-sm text-muted-foreground">
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
    <section className="border-b border-border pb-6" aria-label="Training progress">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Review progress</p>
          <p className="text-xs text-muted-foreground">{reviewed} of {current} current examples reviewed · {stats.stale} outdated revisions excluded</p>
        </div>
        <span className="text-lg font-semibold tabular-nums">{progress}%</span>
      </div>
      <div role="progressbar" aria-label="Review progress" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}
        className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([
          ['To review', stats.ready, 'Awaiting your decision'],
          ['Training', stats.training, 'Approved examples'],
          ['Evaluation', stats.eval, 'Held-out checks'],
          ['Set aside', stats.dismissed, 'Not selected'],
        ] as const).map(([label, value, caption]) => (
          <div key={label}>
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
            <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">{caption}</p>
          </div>
        ))}
      </div>
      {stats.ready > 0 && <p className="mt-4 text-xs text-muted-foreground">In the queue: {Object.entries(stats.by_kind)
        .map(([kind, count]) => `${count} ${KIND_LABELS[kind as keyof typeof KIND_LABELS]?.toLowerCase() ?? kind}`).join(' · ')}</p>}
    </section>
  );
}

export function ReviewDetail({ row, example, destination, onDestination, verified, onVerified, otherPaths, onOtherPaths,
  expected, onExpected, saving, error, canNext = true, onDecide, onNext }: {
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
  error?: string;
  canNext?: boolean;
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
  const errorId = useId();
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const allEvidence = new Map<string, EvidencePreview>();
  for (const hit of [...evidence, ...positive, ...negatives, ...hardNegatives, ...verifierFiles,
    ...row.proposed_files.map((path) => ({ path }))]) {
    if (!allEvidence.has(hit.path)) allEvidence.set(hit.path, hit);
  }
  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="rounded-full bg-muted px-2.5 py-1 font-medium text-foreground">{KIND_LABELS[row.kind]}</span>
        <span>{row.repositories.join(', ') || 'No repository'} · {new Date(row.extracted_at).toLocaleDateString()}</span>
      </div>
      <div>
        <h2 className="text-lg font-semibold leading-snug break-words">{row.query}</h2>
      </div>
      {answer && <div>
        <h3 className="text-sm font-medium">Answer to review</h3>
        <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-border bg-background p-3 text-sm whitespace-pre-wrap wrap-break-word">{answer}</div>
      </div>}
      {typeof example.payload.rejected === 'string' && <div>
        <h3 className="text-sm font-medium">Earlier answer that was rejected</h3>
        <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-border bg-muted/50 p-3 text-sm whitespace-pre-wrap wrap-break-word">{example.payload.rejected}</div>
      </div>}
      {feedback && <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
        <span className="font-medium">User feedback: {feedback.label.replaceAll('_', ' ')}</span>
        {feedback.reason && <p className="mt-1 break-words text-muted-foreground">{feedback.reason}</p>}
      </div>}
      {allEvidence.size > 0 && <div>
        <h3 className="text-sm font-medium">Evidence to check</h3>
        <div className="mt-2 space-y-2">
          {[...allEvidence.values()].map((hit, index) => (
            <div key={`${hit.path}-${index}`} className="rounded-lg border border-border p-3 text-xs">
              <span className="font-mono wrap-break-word">{hit.path}</span>
              {hit.snippet && <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-muted-foreground">{hit.snippet}</p>}
            </div>
          ))}
        </div>
      </div>}

      {row.state === 'ready' && row.eligible ? <fieldset disabled={saving} aria-describedby={error ? errorId : undefined} className="min-w-0 space-y-4 border-t border-border pt-5">
        <legend className="sr-only">Review decision</legend>
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1 text-sm">
          <button type="button" onClick={() => onDestination('training')} aria-pressed={destination === 'training'}
            className={`min-h-11 rounded-md px-3 py-2 font-medium disabled:opacity-50 ${destination === 'training' ? 'bg-background' : 'text-muted-foreground'}`}>Teach the agent</button>
          <button type="button" onClick={() => onDestination('eval')} aria-pressed={destination === 'eval'}
            className={`min-h-11 rounded-md px-3 py-2 font-medium disabled:opacity-50 ${destination === 'eval' ? 'bg-background' : 'text-muted-foreground'}`}>Test the agent</button>
        </div>
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          {destination === 'training' ? <Sparkles className="mt-0.5 size-4 shrink-0" /> : <ShieldCheck className="mt-0.5 size-4 shrink-0" />}
          {destination === 'training' ? 'Training teaches future answers. Approve only if the answer and evidence look right.' : 'Evaluation is held out to measure quality. Check the expected outcome independently before saving it.'}
        </p>
        {(destination === 'eval' || row.kind === 'hard_negative_candidates') && <div className="space-y-3 rounded-lg border border-border p-3">
          <p className="text-xs font-medium">{row.kind === 'hard_negative_candidates' && destination === 'training' ? 'Which proposed results did you verify are wrong?' : 'Which sources did you independently verify?'}</p>
          {choices.map((hit) => <label key={hit.path} className="flex min-h-11 cursor-pointer items-start gap-3 py-3 text-sm">
            <input type="checkbox" checked={verified.includes(hit.path)} onChange={() => onVerified(hit.path)} className="size-5 shrink-0 accent-primary" />
            <span className="font-mono wrap-break-word">{hit.path}</span>
          </label>)}
          {destination === 'eval' && <label className="block text-xs text-muted-foreground">
            Other verified files (one per line, optional)
            <textarea value={otherPaths} onChange={(event) => onOtherPaths(event.currentTarget.value)} rows={2}
              placeholder="src/path/to/verified-file.ts" className="mt-1 w-full rounded-md border border-border bg-background p-3 font-mono text-base text-foreground sm:text-sm" />
          </label>}
          {destination === 'eval' && row.kind !== 'retrieval' && <label className="block text-xs text-muted-foreground">
            Checked expected outcome (if no file applies)
            <textarea value={expected} onChange={(event) => onExpected(event.currentTarget.value)} rows={2} maxLength={4000}
              placeholder="What should a correct result say?" className="mt-1 w-full rounded-md border border-border bg-background p-3 text-base text-foreground sm:text-sm" />
          </label>}
        </div>}
        {error && <p id={errorId} ref={errorRef} tabIndex={-1} role="alert" className="break-words text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={saving} onClick={() => onDecide(destination)}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            <Check className="size-4" /> {saving ? 'Saving…' : destination === 'training' ? 'Add to training' : 'Save evaluation case'}
          </button>
          <button type="button" disabled={saving} onClick={() => onDecide('dismiss')} className="min-h-11 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50">Set aside</button>
          <button type="button" disabled={saving || !canNext} onClick={onNext} className="ml-auto inline-flex min-h-11 items-center gap-1 px-2 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">Next <ArrowRight className="size-4" /></button>
        </div>
      </fieldset> : <p className="flex items-center gap-2 border-t border-border pt-4 text-sm text-muted-foreground">
        <CircleHelp className="size-4 shrink-0" /> {row.state === 'stale' || !row.eligible ? 'This example is outdated after newer feedback. It cannot be approved.' : row.state === 'dismissed' ? 'You set this example aside.' : `Approved for ${row.state === 'eval' ? 'evaluation' : 'training'}.`}
      </p>}
      <details className="border-t border-border pt-4 text-xs text-muted-foreground">
        <summary className="min-h-11 cursor-pointer py-3">Technical record</summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-muted p-3 whitespace-pre-wrap wrap-break-word">{JSON.stringify(example.payload, null, 2)}</pre>
      </details>
    </div>
  );
}
