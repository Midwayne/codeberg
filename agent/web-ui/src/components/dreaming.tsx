import { actionClass } from './button-styles';
import { DreamingReportView } from './dreaming-report';
import { useDreamingPanel } from '../lib/use-dreaming-panel';

import { type DreamingDashboard } from '../lib/dreaming';

import { ErrorNotice } from './ui';

export { actionClass } from './button-styles';

export type DreamingPanelProps = { enabled: boolean };

export function DreamingPanel(props: DreamingPanelProps) {
  const state = useDreamingPanel(props);

  return <DreamingPanelView {...state} />;
}

export type DreamingPanelViewProps = ReturnType<typeof useDreamingPanel>;

function DreamingPanelView(state: DreamingPanelViewProps) {
  return (
    <section className="space-y-4 border-t border-border pt-6" aria-labelledby="dreaming-heading">
      <DreamingHeader state={state} />
      {!state.enabled && (
        <p className="text-sm text-muted-foreground">
          Enable learning and codebase knowledge to generate or apply reports. Existing reports remain readable.
        </p>
      )}
      <DreamingModelNotice state={state} />
      {state.error && (
        <ErrorNotice
          title="Could not update knowledge consolidation"
          detail={state.error}
          onRetry={() => state.setRetry((value) => value + 1)}
        />
      )}
      <p role="status" className="text-sm text-muted-foreground">
        {state.notice || (state.pending ? 'Preparing a knowledge report…' : '')}
      </p>
      {!state.dashboard && !state.error && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading reports…
        </p>
      )}
      <DreamingJobErrors state={state} />
      {state.dashboard && (
        <DreamingReportList
          dashboard={state.dashboard}
          selectedId={state.report?.id}
          busy={state.busy}
          onSelect={(id) => {
            void state.select(id);
          }}
        />
      )}
      {state.report && (
        <DreamingReportView
          report={state.report}
          enabled={state.enabled}
          busy={state.busy}
          onDecision={(action) => {
            void state.act(action);
          }}
        />
      )}
    </section>
  );
}
export type DreamingReportListProps = {
  dashboard: DreamingDashboard;
  selectedId?: string;
  busy: boolean;
  onSelect: (id: string) => void;
};

export function DreamingReportList({ dashboard, selectedId, busy, onSelect }: DreamingReportListProps) {
  if (!dashboard.reports.length)
    return (
      <p className="text-sm leading-6 text-muted-foreground">
        No reports yet. Generate one after a few solved investigations have saved knowledge.
      </p>
    );
  return (
    <ul className="divide-y divide-border" aria-label="Recent consolidation reports">
      {dashboard.reports.map((report) => (
        <li key={report.id}>
          <button
            type="button"
            disabled={busy}
            onClick={() => onSelect(report.id)}
            aria-pressed={selectedId === report.id}
            className="flex min-h-11 w-full flex-wrap items-start justify-between gap-2 rounded-lg p-3 text-start text-sm hover:bg-accent disabled:opacity-50 aria-pressed:bg-accent"
          >
            <span className="min-w-0 flex-1 break-words">
              {report.summary || 'Knowledge report'}
              <span className="mt-1 block text-xs text-muted-foreground">
                {new Date(report.created_at).toLocaleString()} · {report.considered} notes considered
              </span>
            </span>
            <span className="capitalize text-muted-foreground">{report.status}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export type DreamingHeaderProps = { state: Parameters<typeof DreamingPanelView>[0] };

function DreamingHeader({ state }: DreamingHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-2">
        <h3 id="dreaming-heading" className="text-lg font-semibold">
          Knowledge consolidation
        </h3>
        <p className="max-w-prose text-sm leading-6 text-muted-foreground">
          Connect related findings and combine overlapping notes. Review a report before applying it; original notes and
          source references are kept for undo.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={actionClass}
          disabled={state.busy}
          onClick={() => state.setRetry((value) => value + 1)}
        >
          Refresh reports
        </button>
        <button
          type="button"
          className={actionClass}
          disabled={state.busy || !state.enabled || !state.dashboard?.canGenerate || Boolean(state.pending)}
          onClick={() => {
            void state.act();
          }}
        >
          {state.busy && !state.report ? 'Queueing…' : 'Generate report'}
        </button>
      </div>
    </div>
  );
}

export type DreamingJobErrorsProps = { state: Parameters<typeof DreamingPanelView>[0] };

function DreamingJobErrors({ state }: DreamingJobErrorsProps) {
  return state.dashboard?.jobs
    .filter((job) => job.last_error)
    .map((job) => (
      <p key={job.job_id} role="alert" className="break-words text-sm text-destructive">
        {job.status === 'failed' ? 'Report generation failed.' : 'Report generation will retry.'} {job.last_error}{' '}
        Generate a new report after checking the learning model.
      </p>
    ));
}

export { DreamingReportView } from './dreaming-report';

export type DreamingModelNoticeProps = { state: Parameters<typeof DreamingPanelView>[0] };

function DreamingModelNotice({ state }: DreamingModelNoticeProps) {
  return (
    state.enabled &&
    state.dashboard &&
    !state.dashboard.canGenerate && (
      <p className="text-sm text-muted-foreground">
        A learning model and at least one knowledge category are needed to generate a report.
      </p>
    )
  );
}
