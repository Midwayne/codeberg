import { type DreamingDecision, type DreamingReport } from '../lib/dreaming';

import { actionClass } from './button-styles';

export type DreamingReportViewProps = {
  report: DreamingReport;
  enabled: boolean;
  busy: boolean;
  onDecision: (action: DreamingDecision) => void;
};

export function DreamingReportView({ report, enabled, busy, onDecision }: DreamingReportViewProps) {
  return (
    <div className="min-w-0 space-y-4 border-t border-border pt-4">
      <h4 className="break-words text-base font-semibold">{report.summary || 'Knowledge report'}</h4>
      {report.omitted > 0 && (
        <p className="text-sm leading-6 text-muted-foreground">
          {report.omitted} notes were outside this pass’s size limit. This report covers {report.considered} notes.
        </p>
      )}
      {!report.changes.length && (
        <p className="text-sm text-muted-foreground">No changes proposed. Existing knowledge stays as it is.</p>
      )}
      <DreamingChanges report={report} />
      {report.status === 'applied' && (
        <p className="text-sm leading-6 text-muted-foreground">
          Applied views are used while their source notes and evidence remain current. Later source changes can make
          this report inactive. Undo keeps any newer findings.
        </p>
      )}
      <DreamingDecisions report={report} busy={busy} enabled={enabled} onDecision={onDecision} />
    </div>
  );
}

export type DreamingChangesProps = Pick<Parameters<typeof DreamingReportView>[0], 'report'>;

export function DreamingChanges({ report }: DreamingChangesProps) {
  return report.changes.map((change) => (
    <details key={change.before.id} className="border-b border-border pb-3">
      <summary className="min-h-11 cursor-pointer break-words py-3 text-sm font-medium">
        {change.before.title} — {change.after.status === 'archived' ? 'Archive duplicate' : 'Update knowledge'}
      </summary>
      <p className="mb-3 break-words text-sm leading-6 text-muted-foreground">{change.reason}</p>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {[
          ['Before', change.before],
          ['After', change.after],
        ].map(([label, value]) => {
          const artifact = value as typeof change.before;
          return (
            <div key={String(label)} className="min-w-0">
              <h5 className="mb-2 text-sm font-medium">{String(label)}</h5>
              <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs leading-5">
                {artifact.body}
              </pre>
              <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">
                {artifact.source_interactions.length} source investigations · {artifact.claims?.length ?? 0} claims
                {artifact.related_ids?.length ? ` · ${artifact.related_ids.length} related notes` : ''}
                {artifact.merged_into ? ` · Combined into ${artifact.merged_into}` : ''}
              </p>
              {artifact.related_ids?.length ? (
                <p className="mt-1 break-words text-xs text-muted-foreground">
                  Related: {artifact.related_ids.join(', ')}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </details>
  ));
}

export type DreamingDecisionsProps = Pick<
  Parameters<typeof DreamingReportView>[0],
  'report' | 'busy' | 'enabled' | 'onDecision'
>;

export function DreamingDecisions({ report, busy, enabled, onDecision }: DreamingDecisionsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {report.status === 'proposed' && (
        <>
          <button
            type="button"
            className={actionClass}
            disabled={busy || !enabled || !report.changes.length}
            onClick={() => onDecision('apply')}
          >
            Apply report
          </button>
          <button
            type="button"
            className={actionClass}
            disabled={busy || !enabled}
            onClick={() => onDecision('dismiss')}
          >
            Dismiss report
          </button>
        </>
      )}
      {report.status === 'applied' && (
        <button type="button" className={actionClass} disabled={busy || !enabled} onClick={() => onDecision('undo')}>
          Undo report
        </button>
      )}
    </div>
  );
}
