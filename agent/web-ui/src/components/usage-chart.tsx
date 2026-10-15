import { useState } from 'react';
import type { UsageReport } from '@agent/core/usage';
import { formatTokens } from '../lib/model-usage';
import { Select } from './ui';
import { useMediaQuery } from '../lib/use-media-query';

type Day = UsageReport['daily'][number];
type Metric = 'input' | 'output';
const valueOf = (day: Day, metric: Metric) => metric === 'input' ? day.inputTokens : day.outputTokens;
const describeDay = (day: Day) => `${day.date}: ${formatTokens(day.inputTokens)} input tokens · ${formatTokens(day.outputTokens)} output tokens`;

export function UsageChart({ report }: { report: UsageReport }) {
  const [metric, setMetric] = useState<Metric>('input');
  const [active, setActive] = useState<Day>();
  const days = chartDays(report);
  const maximum = Math.max(...days.map((day) => valueOf(day, metric))) || 1;
  const chartWidth = useMediaQuery('(min-width: 640px)') ? 720 : 360;

  return (
    <section className="rounded-xl border border-border p-4 sm:p-5" aria-label="Daily usage">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="font-medium">Your usage</h3><p className="mt-1 text-sm text-muted-foreground">Daily activity across all projects · UTC</p></div>
        <label className="text-sm">Show <Select value={metric} onChange={(event) => {
          setMetric(event.target.value as Metric);
          setActive(undefined);
        }}>
          <option value="input">Input tokens</option><option value="output">Output tokens</option>
        </Select></label>
      </div>
      <div className="mt-5 overflow-x-auto">
        <svg viewBox={`0 0 ${chartWidth} 220`} className="w-full" role="group" aria-label={`Daily ${metric} tokens chart`}>
          {[0, 0.5, 1].map((fraction) => <g key={fraction}>
            <line x1="62" x2={chartWidth - 8} y1={175 - fraction * 155} y2={175 - fraction * 155} className="stroke-border" />
            <text x="52" y={179 - fraction * 155} textAnchor="end" className="fill-muted-foreground text-[11px]">{formatTokens(maximum * fraction)}</text>
          </g>)}
          {days.map((day, index) => <DayBar key={day.date} day={day} index={index} count={days.length} maximum={maximum}
            metric={metric} chartWidth={chartWidth} active={active?.date === day.date} onActive={setActive} />)}
        </svg>
      </div>
      <p className="min-h-5 text-xs text-muted-foreground tabular-nums" role="status">
        {active ? describeDay(active)
          : 'Hover or focus a bar to inspect daily totals. Use Tab to move between days.'}
      </p>
    </section>
  );
}

function DayBar({ day, index, count, maximum, metric, chartWidth, active, onActive }: {
  day: Day; index: number; count: number; maximum: number; metric: Metric; chartWidth: number; active: boolean; onActive: (day: Day) => void;
}) {
  const width = (chartWidth - 70) / count;
  const height = valueOf(day, metric) / maximum * 155;
  const x = 62 + index * width;
  const label = describeDay(day);

  return (
    <g tabIndex={0} role="img" aria-label={label} onMouseEnter={() => onActive(day)} onFocus={() => onActive(day)}
      className="outline-none focus-visible:[&>rect]:stroke-ring focus-visible:[&>rect]:stroke-2">
      <rect x={x + width * 0.2} y={175 - Math.max(1, height)} width={width * 0.6} height={Math.max(1, height)} rx="2"
        className={active ? 'fill-foreground' : 'fill-primary/60'} />
      <rect x={x} y="20" width={width} height="155" fill="transparent" />
      {index % Math.ceil(count / (chartWidth < 640 ? 3 : 6)) === 0 && <text x={x + width / 2} y="204" textAnchor="middle"
        className="fill-muted-foreground text-[11px]">{day.date.slice(5)}</text>}
    </g>
  );
}

function chartDays(report: UsageReport): Day[] {
  const days = new Map(report.daily.map((day) => [day.date, day]));
  const result: Day[] = [];

  for (let timestamp = Date.parse(report.start); timestamp < Date.parse(report.end); timestamp += 86_400_000) {
    const date = new Date(timestamp).toISOString().slice(0, 10);
    result.push(days.get(date) ?? { date, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
      cacheWriteTokens: 0, costUsd: 0, unpricedRequests: 0, unreportedRequests: 0 });
  }

  return result;
}
