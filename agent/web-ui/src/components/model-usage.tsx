import type { UsageReport } from '@agent/core/usage';
import { useModelUsage } from '../lib/use-model-usage';
import { UsageControls, type UsageControlsProps } from './usage-controls';
import { UsageCoverage, UsageMetrics } from './usage-summary';
import { UsageChart } from './usage-chart';
import { UsageHistory, UsageModels } from './usage-history';
import { ErrorNotice } from './ui';
import { buttonClass } from './button-styles';

export function ModelUsagePanel() {
  const state = useModelUsage();

  return <UsageView {...state} />;
}

export type UsageViewProps = UsageControlsProps & {
  report?: UsageReport;
  error?: string;
  onPage: (page: number) => void;
  onRetry?: () => void;
};

export function UsageView({ report, error, onPage, onRetry, ...controls }: UsageViewProps) {
  return (
    <section className="space-y-5" aria-label="Model usage">
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-lg font-semibold">Usage</h2><p className="mt-1 text-sm text-muted-foreground">All projects · model tokens and estimated spend</p></div>
        {onRetry && <button type="button" className={buttonClass} onClick={onRetry}>Refresh</button>}
      </div>
      <UsageControls {...controls} />
      {error && <ErrorNotice title="Could not load or export usage" detail={error} onRetry={onRetry ?? (() => undefined)} />}
      {!report && !error && <p role="status" className="text-sm text-muted-foreground">Loading usage…</p>}
      {report && <UsageContent report={report} onPage={onPage} />}
    </section>
  );
}

function UsageContent({ report, onPage }: { report: UsageReport; onPage: (page: number) => void }) {
  return (
    <>
      <UsageMetrics totals={report.totals} />
      {Boolean(report.failedWrites) && <p role="alert" className="text-sm text-destructive">{report.failedWrites} requests could not be saved since the server started. Usage totals are incomplete. Check the server’s storage and logs.</p>}
      <UsageCoverage totals={report.totals} />
      {report.totals.requests > 0 ? <>
        <UsageChart report={report} />
        {report.models.length > 0 && <UsageModels models={report.models} />}
        <UsageHistory report={report} onPage={onPage} />
      </> : <div className="rounded-xl border border-dashed border-border px-5 py-10 text-center">
        <h3 className="font-medium">No usage recorded for this period</h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">Tracking starts with new model calls after this update. Send a chat or run a learning job, then refresh to see its usage. Earlier spending is unavailable.</p>
      </div>}
    </>
  );
}
