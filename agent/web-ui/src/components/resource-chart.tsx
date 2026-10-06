import { ResourcePlot, ResourceTooltip } from './resource-plot';
import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { type ResourceSample } from '../lib/resources';

export function sampleAtPosition(
  rows: ResourceSample[],
  start: number,
  end: number,
  fraction: number,
): ResourceSample | undefined {
  const timestamp = start + Math.max(0, Math.min(1, fraction)) * (end - start);
  return rows.reduce<ResourceSample | undefined>(
    (nearest, row) =>
      !nearest || Math.abs(row.timestamp - timestamp) < Math.abs(nearest.timestamp - timestamp) ? row : nearest,
    undefined,
  );
}

export type ResourceChartProps = {
  title: string;
  rows: ResourceSample[];
  value: (row: ResourceSample) => number;
  format: (value: number) => string;
  range: number;
  end: number;
};

export function ResourceChart(props: ResourceChartProps) {
  const state = useResourceChart(props);

  return <ResourceChartView {...state} />;
}

export type ResourceChartOptions = {
  title: string;
  rows: ResourceSample[];
  value: (row: ResourceSample) => number;
  format: (value: number) => string;
  range: number;
  end: number;
};

function useResourceChart({ title, rows, value, format, range, end }: ResourceChartOptions) {
  const tooltipId = useId();
  const [activeTimestamp, setActiveTimestamp] = useState<number>();
  const active = rows.find((row) => row.timestamp === activeTimestamp);
  const latest = rows.at(-1);
  const start = end - range * 60_000;
  const x = (row: ResourceSample) => Math.max(0, Math.min(300, ((row.timestamp - start) / (end - start)) * 300));
  const { maximum, points } = useMemo(() => {
    const maximum = Math.max(1, ...rows.map(value)) * 1.15;
    const points = rows
      .map(
        (row) =>
          `${Math.max(0, Math.min(300, ((row.timestamp - start) / (end - start)) * 300))},${110 - (Math.max(0, value(row)) / maximum) * 100}`,
      )
      .join(' ');
    return { maximum, points };
  }, [rows, value, start, end]);
  const y = (row: ResourceSample) => 110 - (Math.max(0, value(row)) / maximum) * 100;
  const { point, navigate } = createChartNavigation({ setActiveTimestamp, rows, start, end, activeTimestamp });

  return {
    title,
    latest,
    format,
    value,
    active,
    tooltipId,
    point,
    setActiveTimestamp,
    navigate,
    points,
    rows,
    x,
    y,
    range,
    maximum,
  };
}

export type ResourceChartViewProps = ReturnType<typeof useResourceChart>;

export function ResourceChartView(state: ResourceChartViewProps) {
  return (
    <figure className="rounded-xl border border-border p-3">
      <ResourceCaption title={state.title} latest={state.latest} format={state.format} value={state.value} />
      {state.latest ? (
        <>
          <div className="relative">
            <ResourcePlot
              title={state.title}
              active={state.active}
              tooltipId={state.tooltipId}
              point={state.point}
              setActiveTimestamp={state.setActiveTimestamp}
              latest={state.latest}
              navigate={state.navigate}
              points={state.points}
              rows={state.rows}
              x={state.x}
              y={state.y}
            />
            <ResourceTooltip
              active={state.active}
              tooltipId={state.tooltipId}
              x={state.x}
              title={state.title}
              format={state.format}
              value={state.value}
            />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{state.range} min ago</span>
            <span>0–{state.format(state.maximum)} · now</span>
          </div>
        </>
      ) : (
        <p className="flex h-32 items-center justify-center text-xs text-muted-foreground">No samples yet</p>
      )}
    </figure>
  );
}

export type ChartNavigationOptions = Pick<Parameters<typeof useResourceChart>[0], 'rows' | 'end'> & {
  setActiveTimestamp: React.Dispatch<React.SetStateAction<number | undefined>>;
  start: number;
  activeTimestamp: number | undefined;
};

function createChartNavigation({ setActiveTimestamp, rows, start, end, activeTimestamp }: ChartNavigationOptions) {
  function point(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    setActiveTimestamp(sampleAtPosition(rows, start, end, (event.clientX - rect.left) / rect.width)?.timestamp);
  }

  function navigate(event: KeyboardEvent<SVGSVGElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = rows.findIndex((row) => row.timestamp === activeTimestamp);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? rows.length - 1
          : event.key === 'ArrowLeft'
            ? Math.max(0, current < 0 ? rows.length - 1 : current - 1)
            : Math.min(rows.length - 1, current + 1);
    setActiveTimestamp(rows[next]?.timestamp);
  }

  return { point, navigate };
}

export type ResourceCaptionProps = Pick<
  Parameters<typeof ResourceChartView>[0],
  'title' | 'latest' | 'format' | 'value'
>;

function ResourceCaption({ title, latest, format, value }: ResourceCaptionProps) {
  return (
    <figcaption className="mb-3 flex justify-between gap-2 text-xs font-medium">
      <span>{title}</span>
      <span className="tabular-nums text-muted-foreground">{latest ? format(value(latest)) : '—'}</span>
    </figcaption>
  );
}
