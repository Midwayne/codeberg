import type { UsageRecord, UsageReport } from '@agent/core/usage';
import { formatCost, formatTokens } from '../lib/model-usage';
import { buttonClass } from './button-styles';
import { CacheDetails, UsageModelList, UsageRequestList } from './usage-mobile';

export function UsageModels({ models }: Pick<UsageReport, 'models'>) {
  return (
    <section aria-label="Usage by model" className="space-y-3">
      <h3 className="font-medium">By model</h3>
      <UsageModelList models={models} />
      <div className="hidden overflow-x-auto rounded-xl border border-border sm:block">
        <table className="w-full min-w-[480px] text-left text-sm tabular-nums">
          <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground"><tr>
            {['Model', 'Requests', 'Tokens', 'Estimated USD'].map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-border">{models.map((model) => <tr key={model.model}>
            <th scope="row" className="max-w-72 break-words px-4 py-3 font-medium">{model.model}</th>
            <td className="px-4 py-3">{model.requests.toLocaleString()}</td>
            <td className="px-4 py-3">{formatTokens(model.inputTokens + model.outputTokens)}</td>
            <td className="px-4 py-3">{formatCost(model.unpricedRequests === model.requests ? null : model.costUsd)}{model.unpricedRequests > 0 && model.unpricedRequests < model.requests ? ' + unpriced' : ''}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

export function UsageHistory({ report, onPage }: { report: UsageReport; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(report.totals.requests / report.pageSize));
  const from = (report.page - 1) * report.pageSize + 1;

  return (
    <section aria-label="Request history" className="space-y-3">
      <div><h3 className="font-medium">Request history</h3><p className="mt-1 text-xs text-muted-foreground">One row per completed provider call, including tool-loop steps. Dates are UTC.</p></div>
      <UsageRequestList records={report.records} />
      <div className="hidden overflow-x-auto rounded-xl border border-border sm:block">
        <table className="w-full min-w-[720px] text-left text-sm tabular-nums">
          <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground"><tr>
            {['Date (UTC)', 'Project', 'Type / Model', 'Input', 'Output', 'Estimated USD'].map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-border">{report.records.map((row) => <UsageRow key={row.id} row={row} />)}</tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <p>Showing {from.toLocaleString()}–{Math.min(report.page * report.pageSize, report.totals.requests).toLocaleString()} of {report.totals.requests.toLocaleString()}</p>
        <div className="flex items-center gap-3">
          <button type="button" className={buttonClass} disabled={report.page <= 1} onClick={() => onPage(report.page - 1)}>Previous</button>
          <span>Page {report.page} / {pages}</span>
          <button type="button" className={buttonClass} disabled={report.page >= pages} onClick={() => onPage(report.page + 1)}>Next</button>
        </div>
      </div>
    </section>
  );
}

function UsageRow({ row }: { row: UsageRecord }) {
  const token = (value: number | null) => value === null ? 'Not reported' : formatTokens(value);
  const timestamp = new Date(row.timestamp).toISOString();

  return (
    <tr className="hover:bg-muted/30">
      <td className="whitespace-nowrap px-4 py-3"><time dateTime={timestamp}>{timestamp.slice(0, 10)}<br />{timestamp.slice(11, 16)}</time></td>
      <td className="max-w-40 break-words px-4 py-3">{row.projectName ?? row.project ?? 'Unassigned'}</td>
      <td className="max-w-64 break-words px-4 py-3"><span className="text-xs text-muted-foreground">{row.kind === 'learning' ? 'Learning' : 'Chat'}</span><div title={row.key}>{row.model}</div></td>
      <td className="px-4 py-3">{token(row.inputTokens)}<CacheDetails row={row} /></td>
      <td className="px-4 py-3">{token(row.outputTokens)}</td>
      <td className="whitespace-nowrap px-4 py-3">{row.costUsd === null ? <span className="text-muted-foreground">Unpriced</span> : formatCost(row.costUsd)}</td>
    </tr>
  );
}
