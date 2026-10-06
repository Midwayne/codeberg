import { type ResourceUsageView } from './resource-usage';

import { formatBytes, type ResourceSample } from '../lib/resources';
import { ResourceChart } from './resource-chart';

export type MetricProps = { label: string; value: string; detail: string };

export function Metric({ label, value, detail }: MetricProps) {
  return (
    <div className="rounded-xl border border-border p-4">
      <h3 className="text-sm text-muted-foreground">{label}</h3>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

export type ResourceMetricsProps = {
  current: ResourceSample | null;
  percentage: (value: number) => string;
  percent: (used: number, total: number) => number;
};

export function ResourceMetrics({ current, percentage, percent }: ResourceMetricsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Metric
        label="Codeberg CPU"
        value={current?.cpu.usedPercent != null ? percentage(current.cpu.usedPercent) : '—'}
        detail={
          current?.cpu.corePercent != null
            ? `Of total CPU capacity · ${current.cpu.corePercent.toFixed(1)}% of one core · ${current.cpu.cores} cores`
            : 'Waiting for a complete CPU interval…'
        }
      />
      <Metric
        label="Codeberg memory"
        value={current ? formatBytes(current.memory.usedBytes) : '—'}
        detail={
          current
            ? `${percentage(percent(current.memory.usedBytes, current.memory.totalBytes))} of ${formatBytes(current.memory.totalBytes)} physical RAM`
            : 'Waiting for first sample'
        }
      />
      <Metric
        label="Codeberg disk"
        value={current?.disk ? formatBytes(current.disk.codebergBytes) : '—'}
        detail={
          current?.disk ? 'Space occupied by Codeberg’s local data, models, and indexes' : 'Disk metrics unavailable'
        }
      />
    </div>
  );
}

export type MeasuredProcessesProps = Pick<Parameters<typeof ResourceUsageView>[0], 'usage'> & {
  current: ResourceSample | null;
  scopes: Record<
    'managed-stack' | 'web-and-daemon' | 'daemon-process-tree' | 'web-process-tree' | 'web-process',
    string
  >;
};

export function MeasuredProcesses({ current, scopes, usage }: MeasuredProcessesProps) {
  return (
    <div className="rounded-xl border border-border p-4 text-sm">
      <h3 className="font-medium">Measured processes</h3>
      <p className="mt-2 text-muted-foreground">
        {current ? scopes[current.scope] : 'Waiting for process measurements.'}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        CPU uses the change in process CPU time between samples. Memory is summed resident memory (RSS); shared pages
        may be counted by more than one process. Unrelated apps and the browser are excluded. Collection runs in{' '}
        {usage.collector === 'daemon' ? 'the daemon' : 'a dedicated worker'}; disk is refreshed every five minutes and
        after cleanup.
      </p>
      <ProcessTable current={current} />
    </div>
  );
}

export type ProcessTableProps = Pick<Parameters<typeof MeasuredProcesses>[0], 'current'>;

export function ProcessTable({ current }: ProcessTableProps) {
  return (
    current && (
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="pb-2 font-medium">Process</th>
              <th className="pb-2 font-medium">PID</th>
              <th className="pb-2 font-medium">CPU (100% = one core)</th>
              <th className="pb-2 font-medium">Resident memory</th>
            </tr>
          </thead>
          <tbody>
            {current.processes.map((item) => (
              <tr key={item.pid} className="border-t border-border">
                <td className="py-2 pr-3">{item.name}</td>
                <td className="pr-3 tabular-nums">{item.pid}</td>
                <td className="pr-3 tabular-nums">
                  {item.cpuPercent === null ? '—' : `${item.cpuPercent.toFixed(1)}%`}
                </td>
                <td className="tabular-nums">{formatBytes(item.memoryBytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  );
}

export type ResourceHistoryProps = Pick<Parameters<typeof ResourceUsageView>[0], 'range'> & {
  rows: ResourceSample[];
  percentage: (value: number) => string;
  end: number;
};

export function ResourceHistory({ rows, percentage, range, end }: ResourceHistoryProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <ResourceChart
        title="CPU history"
        rows={rows.filter((row) => row.cpu.usedPercent !== null)}
        value={(row) => row.cpu.usedPercent ?? 0}
        format={percentage}
        range={range}
        end={end}
      />
      <ResourceChart
        title="Memory history"
        rows={rows}
        value={(row) => row.memory.usedBytes}
        format={formatBytes}
        range={range}
        end={end}
      />
      <ResourceChart
        title="Disk history"
        rows={rows.filter((row) => row.disk)}
        value={(row) => row.disk?.codebergBytes ?? 0}
        format={formatBytes}
        range={range}
        end={end}
      />
    </div>
  );
}
