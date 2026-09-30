import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';

import type { ResourceSample } from '@/lib/resources';

/** Match pointer time to a real sample; never invent interpolated usage values. */
export function sampleAtPosition(rows: ResourceSample[], start: number, end: number, fraction: number): ResourceSample | undefined {
  const timestamp = start + Math.max(0, Math.min(1, fraction)) * (end - start);
  return rows.reduce<ResourceSample | undefined>((nearest, row) =>
    !nearest || Math.abs(row.timestamp - timestamp) < Math.abs(nearest.timestamp - timestamp) ? row : nearest, undefined);
}

export function ResourceChart({ title, rows, value, format, range, end }: {
  title: string;
  rows: ResourceSample[];
  value: (row: ResourceSample) => number;
  format: (value: number) => string;
  range: number;
  end: number;
}) {
  const tooltipId = useId();
  const [activeTimestamp, setActiveTimestamp] = useState<number>();
  const active = rows.find((row) => row.timestamp === activeTimestamp);
  const latest = rows.at(-1);
  const start = end - range * 60_000;
  const x = (row: ResourceSample) => Math.max(0, Math.min(300, (row.timestamp - start) / (end - start) * 300));
  const { maximum, points } = useMemo(() => {
    const maximum = Math.max(1, ...rows.map(value)) * 1.15;
    const points = rows.map((row) => `${Math.max(0, Math.min(300, (row.timestamp - start) / (end - start) * 300))},${110 - Math.max(0, value(row)) / maximum * 100}`).join(' ');
    return { maximum, points };
  }, [rows, value, start, end]);
  const y = (row: ResourceSample) => 110 - Math.max(0, value(row)) / maximum * 100;

  function point(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    setActiveTimestamp(sampleAtPosition(rows, start, end, (event.clientX - rect.left) / rect.width)?.timestamp);
  }

  function navigate(event: KeyboardEvent<SVGSVGElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = rows.findIndex((row) => row.timestamp === activeTimestamp);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1
      : event.key === 'ArrowLeft' ? Math.max(0, current < 0 ? rows.length - 1 : current - 1)
        : Math.min(rows.length - 1, current + 1);
    setActiveTimestamp(rows[next]?.timestamp);
  }

  return (
    <figure className="rounded-xl border border-border p-3">
      <figcaption className="mb-3 flex justify-between gap-2 text-xs font-medium">
        <span>{title}</span><span className="tabular-nums text-muted-foreground">{latest ? format(value(latest)) : '—'}</span>
      </figcaption>
      {latest ? <>
        <div className="relative">
          <svg viewBox="0 0 300 120" preserveAspectRatio="none" role="img" tabIndex={0}
            aria-label={`${title}. Use arrow keys to inspect samples.`}
            aria-keyshortcuts="ArrowLeft ArrowRight Home End"
            aria-describedby={active ? tooltipId : undefined}
            onPointerMove={point} onPointerDown={point} onPointerLeave={() => setActiveTimestamp(undefined)}
            onFocus={() => setActiveTimestamp(latest.timestamp)} onBlur={() => setActiveTimestamp(undefined)}
            onKeyDown={navigate}
            className="h-32 w-full text-primary focus-visible:outline-2 focus-visible:outline-ring">
            <path d="M0 10H300 M0 60H300 M0 110H300" className="stroke-border" fill="none" />
            <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            {rows.length === 1 && <circle cx={x(latest)} cy={y(latest)} r="3" fill="currentColor" />}
            {active && <>
              <line x1={x(active)} x2={x(active)} y1="10" y2="110" stroke="currentColor" strokeDasharray="3 3" />
              <circle cx={x(active)} cy={y(active)} r="4" fill="currentColor" />
            </>}
          </svg>
          {active && <div id={tooltipId} role="tooltip"
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-background px-3 py-2 text-xs shadow-lg"
            style={{ left: `${Math.max(20, Math.min(80, x(active) / 3))}%` }}>
            <p className="text-muted-foreground">{new Date(active.timestamp).toLocaleString()}</p>
            <p className="mt-1 font-medium tabular-nums">{title}: {format(value(active))}</p>
          </div>}
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>{range} min ago</span><span>0–{format(maximum)} · now</span>
        </div>
      </> : <p className="flex h-32 items-center justify-center text-xs text-muted-foreground">No samples yet</p>}
    </figure>
  );
}
