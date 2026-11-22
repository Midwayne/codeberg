import { AlarmClock, ChevronDown, Moon } from 'lucide-react';

import { useScheduleWorkspace } from '../../lib/schedule-workspace';
import { sleepView, type SleepView } from '../../lib/sleep';
import { cn } from '../../lib/utils';
import type { ToolView } from './message';
import { ToolPending } from './tool-status';
import { useNow } from './use-elapsed';

/**
 * `sleep_agent` reads as a timeline event: the agent paused this chat and
 * wakes at its chosen time, or earlier once the jobs it waits on finish.
 * It follows the project's live schedule list, so it changes to "Waking up…"
 * and "Woke up" without a reload.
 */
export function SleepMarker({ part }: { part: ToolView }) {
  const jobs = useScheduleWorkspace()?.jobs;
  const first = sleepView(part, jobs, Date.now());
  const now = useNow(first?.phase === 'sleeping');
  const view = sleepView(part, jobs, now);

  if (!view) return <ToolPending name="sleep_agent" part={part} />;

  return (
    <details className="group/sleep my-2 w-full min-w-0 text-xs text-muted-foreground">
      <summary
        aria-live="polite"
        className="flex min-h-11 cursor-pointer list-none items-center gap-3 md:min-h-8 [&::-webkit-details-marker]:hidden"
      >
        <span aria-hidden="true" className="h-px flex-1 bg-border" />

        <span className={cn(
          'inline-flex min-w-0 shrink items-center gap-1.5 rounded-full border bg-card px-3 py-1 transition-colors group-hover/sleep:text-foreground',
          view.phase === 'failed' ? 'border-destructive/40 text-destructive' : 'border-border',
        )}>
          <SleepIcon view={view} />
          <span className="truncate tabular-nums">{view.label}</span>
          {view.detail && <span className="hidden truncate opacity-70 sm:inline">{view.detail}</span>}
          <ChevronDown className="size-3.5 shrink-0 transition-transform group-open/sleep:rotate-180" aria-hidden="true" />
        </span>

        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </summary>

      <SleepDetails view={view} />
    </details>
  );
}

function SleepIcon({ view }: { view: SleepView }) {
  const common = 'size-3.5 shrink-0';

  if (view.phase === 'waking' || view.phase === 'awake') return <AlarmClock className={common} aria-hidden="true" />;

  return <Moon className={cn(common, view.phase === 'sleeping' && 'motion-safe:animate-pulse')} aria-hidden="true" />;
}

function SleepDetails({ view }: { view: SleepView }) {
  const due = view.dueAt === undefined ? undefined : new Date(view.dueAt).toLocaleString();

  return (
    <div className="mx-auto mt-2 max-w-prose space-y-1 rounded-lg border border-border bg-card/40 px-3 py-2 leading-5">
      {due && <p>Wakes at {due}{view.detail ? `, ${view.detail}` : ''}.</p>}
      {view.prompt && <p className="whitespace-pre-wrap text-foreground/80 [overflow-wrap:anywhere]">{view.prompt}</p>}
      <p className="text-[11px]">Cancel the wake-up from Scheduled runs in the header.</p>
    </div>
  );
}
