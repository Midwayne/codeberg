import { useProjectApi } from '../lib/project-api';

import { useEffect, useRef, useState } from 'react';
import { loadResourceUsage, mergeResourceUsage, type ResourceSample, type ResourceUsage } from '../lib/resources';

import { ErrorNotice, Select } from './ui';
import { ResourceMetrics, MeasuredProcesses, ResourceHistory } from './resource-metrics';

export function ResourceUsagePanel() {
  const state = useResourceUsagePanel();

  return <ResourceUsagePanelView {...state} />;
}

export function useResourceUsagePanel() {
  const { fetch: api } = useProjectApi();
  const [usage, setUsage] = useState<ResourceUsage>();
  const [error, setError] = useState('');
  const [range, setRange] = useState(60);
  const [retry, setRetry] = useState(0);
  const latest = useRef<ResourceUsage>(undefined);
  useEffect(() => {
    let active = true;
    let loading = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const warmUntil = Date.now() + 5000;
    const refresh = async () => {
      if (loading || document.hidden) return;
      if (timer) clearTimeout(timer);
      loading = true;
      try {
        const value = await loadResourceUsage(latest.current?.current?.timestamp, api);
        if (active) {
          latest.current = mergeResourceUsage(latest.current, value);
          setUsage(latest.current);
          setError('');
        }
      } catch (failure) {
        if (active) setError(String(failure));
      } finally {
        loading = false;
        if (active && !document.hidden) {
          const ready = Date.now() > warmUntil || Boolean(latest.current?.current?.disk);
          timer = setTimeout(() => void refresh(), ready ? 10_000 : 500);
        }
      }
    };
    void refresh();
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [retry]);
  return { error, setError, setRetry, usage, range, setRange };
}

export type ResourceUsagePanelViewProps = ReturnType<typeof useResourceUsagePanel>;

export function ResourceUsagePanelView({
  error,
  setError,
  setRetry,
  usage,
  range,
  setRange,
}: ResourceUsagePanelViewProps) {
  return (
    <>
      {error && (
        <ErrorNotice
          title="Could not load resource usage"
          detail={error}
          onRetry={() => {
            setError('');
            setRetry((value) => value + 1);
          }}
        />
      )}
      {usage ? (
        <ResourceUsageView usage={usage} range={range} onRange={setRange} />
      ) : (
        !error && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading resource usage…
          </p>
        )
      )}
    </>
  );
}

export type ResourceUsageViewProps = {
  usage: ResourceUsage;
  range: number;
  onRange: (value: number) => void;
};

export function ResourceUsageView({ usage, range, onRange }: ResourceUsageViewProps) {
  const current = usage.current;
  const percent = (used: number, total: number) => (total > 0 ? (used / total) * 100 : 0);
  const percentage = (value: number) => `${value.toFixed(2)}%`;
  const rows = usage.history.filter((row) => row.timestamp >= (current?.timestamp ?? Date.now()) - range * 60_000);
  const end = current?.timestamp ?? Date.now();
  const scopes: Record<ResourceSample['scope'], string> = {
    'managed-stack': 'This Codeberg instance: launcher, web server, learning, daemon, indexer, and managed workers.',
    'web-and-daemon': 'Web server, learning, local daemon, indexer, and their child processes.',
    'daemon-process-tree': 'Daemon, indexer, and their workers. The web process is registering with the collector.',
    'web-process-tree':
      'Web server, learning, and their child processes. A separate daemon is not currently identified.',
    'web-process': 'Web server and learning only. Full process-tree measurements are unavailable on this system.',
  };
  return (
    <section className="space-y-5" aria-label="Resource usage">
      <div>
        <h2 className="text-lg font-semibold">Resource usage</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Codeberg’s resource footprint. Samples every 10 seconds; one hour of history is kept by the background
          collector.
        </p>
      </div>
      <ResourceMetrics current={current} percentage={percentage} percent={percent} />
      <MeasuredProcesses current={current} scopes={scopes} usage={usage} />
      <ResourceTimeRange range={range} onRange={onRange} />
      <ResourceHistory rows={rows} percentage={percentage} range={range} end={end} />
      <p className="text-xs text-muted-foreground">
        Hover or tap a chart to inspect the exact sample value and time. Keyboard: focus a chart, then use ← / →.
      </p>
      {current && (
        <p className="text-xs text-muted-foreground">
          Last sampled {new Date(current.timestamp).toLocaleTimeString()}. History resets when the collector restarts.
          {current.disk?.sampledAt ? ` Disk measured ${new Date(current.disk.sampledAt).toLocaleTimeString()}.` : ''}
        </p>
      )}
    </section>
  );
}

export type ResourceTimeRangeProps = Pick<Parameters<typeof ResourceUsageView>[0], 'range' | 'onRange'>;

export function ResourceTimeRange({ range, onRange }: ResourceTimeRangeProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-sm font-medium">Usage history</h3>
      <label className="text-sm">
        Time range{' '}
        <Select value={range} onChange={(event) => onRange(Number(event.currentTarget.value))} wrapperClassName="ml-2">
          <option value={5}>5 minutes</option>
          <option value={15}>15 minutes</option>
          <option value={60}>1 hour</option>
        </Select>
      </label>
    </div>
  );
}
