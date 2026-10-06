import { type ResourceChartView } from './resource-chart';

export type ResourcePlotProps = Pick<
  Parameters<typeof ResourceChartView>[0],
  | 'title'
  | 'active'
  | 'tooltipId'
  | 'point'
  | 'setActiveTimestamp'
  | 'latest'
  | 'navigate'
  | 'points'
  | 'rows'
  | 'x'
  | 'y'
>;

export function ResourcePlot({
  title,
  active,
  tooltipId,
  point,
  setActiveTimestamp,
  latest,
  navigate,
  points,
  rows,
  x,
  y,
}: ResourcePlotProps) {
  if (!latest) return null;

  return (
    <svg
      viewBox="0 0 300 120"
      preserveAspectRatio="none"
      role="img"
      tabIndex={0}
      aria-label={`${title}. Use arrow keys to inspect samples.`}
      aria-keyshortcuts="ArrowLeft ArrowRight Home End"
      aria-describedby={active ? tooltipId : undefined}
      onPointerMove={point}
      onPointerDown={point}
      onPointerLeave={() => setActiveTimestamp(undefined)}
      onFocus={() => setActiveTimestamp(latest.timestamp)}
      onBlur={() => setActiveTimestamp(undefined)}
      onKeyDown={navigate}
      className="h-32 w-full text-primary focus-visible:outline-2 focus-visible:outline-ring"
    >
      <path d="M0 10H300 M0 60H300 M0 110H300" className="stroke-border" fill="none" />
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {rows.length === 1 && <circle cx={x(latest)} cy={y(latest)} r="3" fill="currentColor" />}
      <ResourceActivePoint active={active} x={x} y={y} />
    </svg>
  );
}

export type ResourceTooltipProps = Pick<
  Parameters<typeof ResourceChartView>[0],
  'active' | 'tooltipId' | 'x' | 'title' | 'format' | 'value'
>;

export function ResourceTooltip({ active, tooltipId, x, title, format, value }: ResourceTooltipProps) {
  return (
    active && (
      <div
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-background px-3 py-2 text-xs shadow-lg"
        style={{ left: `${Math.max(20, Math.min(80, x(active) / 3))}%` }}
      >
        <p className="text-muted-foreground">{new Date(active.timestamp).toLocaleString()}</p>
        <p className="mt-1 font-medium tabular-nums">
          {title}: {format(value(active))}
        </p>
      </div>
    )
  );
}

export type ResourceActivePointProps = Pick<Parameters<typeof ResourcePlot>[0], 'active' | 'x' | 'y'>;

export function ResourceActivePoint({ active, x, y }: ResourceActivePointProps) {
  return (
    active && (
      <>
        <line x1={x(active)} x2={x(active)} y1="10" y2="110" stroke="currentColor" strokeDasharray="3 3" />
        <circle cx={x(active)} cy={y(active)} r="4" fill="currentColor" />
      </>
    )
  );
}
