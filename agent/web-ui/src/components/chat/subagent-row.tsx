import { ChevronRight, CircleCheck, CircleX, Clock3, Loader2, TriangleAlert } from 'lucide-react';
import { memo, useState, type ReactNode } from 'react';

import type { SubagentRow, SubagentStatus } from '../../lib/subagents';
import { Response } from './response';
import { formatElapsed } from './working-phase';

type SubagentRowProps = { row: SubagentRow; single: boolean; now: number };

const STATUS_LABEL: Record<SubagentStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Done',
  incomplete: 'Stopped at its step limit',
  failed: 'Failed',
};

/** One subagent: status, label, live activity, and an expandable brief and report. */
export const SubagentRowView = memo(function SubagentRowView({ row, single, now }: SubagentRowProps) {
  // Follows the default (a lone finished report opens) until the user toggles it.
  const [toggled, setToggled] = useState<boolean>();
  const open = toggled ?? (single && Boolean(row.report || row.error));
  const elapsed = row.status === 'running' && row.startedAt ? now - row.startedAt : row.elapsedMs;

  return (
    <details open={open} onToggle={(event) => setToggled(event.currentTarget.open)} className="group/subagent">
      <summary className="flex min-w-0 cursor-pointer list-none items-start gap-2 px-3 py-2 text-xs hover:bg-accent/40 [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform group-open/subagent:rotate-90" />
        <StatusIcon status={row.status} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-medium text-foreground">{row.description}</span>
            <span className="shrink-0 rounded border border-border px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              {row.agentType}
            </span>
          </span>
          <RowSubtitle row={row} />
          <span className="mt-0.5 block tabular-nums text-[11px] text-muted-foreground sm:hidden">{meta(row, elapsed)}</span>
        </span>
        <span className="hidden shrink-0 tabular-nums text-muted-foreground sm:inline">{meta(row, elapsed)}</span>
      </summary>
      {open && <RowDetails row={row} />}
    </details>
  );
}, sameRow);

/** Rows re-render only when their own data changes, or every tick while running. */
function sameRow(before: SubagentRowProps, after: SubagentRowProps): boolean {
  if (before.single !== after.single) return false;

  if (after.row.status === 'running' && before.now !== after.now) return false;

  return JSON.stringify(before.row) === JSON.stringify(after.row);
}

function RowSubtitle({ row }: { row: SubagentRow }) {
  if (row.status === 'running') {
    return (
      <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
        {row.activity ?? 'Thinking…'}
      </span>
    );
  }

  if (row.status === 'failed' && row.error) {
    return <span className="mt-0.5 block truncate text-[11px] text-destructive">{row.error}</span>;
  }

  return <span className="sr-only">{STATUS_LABEL[row.status]}</span>;
}

function RowDetails({ row }: { row: SubagentRow }) {
  return (
    <div className="space-y-3 border-t border-border bg-background/40 px-3 py-2 pl-9 text-xs">
      {row.report && <Section label={row.status === 'incomplete' ? 'Partial report' : 'Report'}>
        <Response className="space-y-2 text-xs leading-relaxed">{row.report}</Response>
      </Section>}
      {row.error && <Section label="Error"><p className="text-destructive">{row.error}</p></Section>}
      {row.brief && <Section label="Brief">
        <p className="whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">{row.brief}</p>
      </Section>}
      <Footnote row={row} />
    </div>
  );
}

function Footnote({ row }: { row: SubagentRow }) {
  const tokens = row.usage ? `${(row.usage.input_tokens + row.usage.output_tokens).toLocaleString()} tokens` : '';
  const text = [STATUS_LABEL[row.status], tokens].filter(Boolean).join(' · ');

  return (
    <p className="text-[11px] text-muted-foreground">
      {text}
      {row.transcript && <> · transcript <span className="break-all font-mono">{row.transcript}</span></>}
    </p>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function StatusIcon({ status }: { status: SubagentStatus }) {
  const label = STATUS_LABEL[status];
  const common = 'mt-0.5 size-3.5 shrink-0';

  switch (status) {
    case 'queued':
      return <Clock3 aria-label={label} className={`${common} text-muted-foreground`} />;
    case 'running':
      return <Loader2 aria-label={label} className={`${common} animate-spin text-primary motion-reduce:animate-none`} />;
    case 'completed':
      return <CircleCheck aria-label={label} className={`${common} text-emerald-600 dark:text-emerald-400`} />;
    case 'incomplete':
      return <TriangleAlert aria-label={label} className={`${common} text-amber-600 dark:text-amber-400`} />;
    case 'failed':
      return <CircleX aria-label={label} className={`${common} text-destructive`} />;
    default:
      return status satisfies never;
  }
}

function meta(row: SubagentRow, elapsed: number | undefined): string {
  const parts = [
    row.steps && row.status === 'running' ? `step ${row.steps}` : '',
    row.toolCalls ? `${row.toolCalls} tool${row.toolCalls === 1 ? '' : 's'}` : '',
    elapsed !== undefined ? formatElapsed(Math.floor(elapsed / 1000)) : '',
  ];

  return parts.filter(Boolean).join(' · ');
}
