import { Loader2, Network } from 'lucide-react';

import { subagentView } from '../../lib/subagents';
import { cn } from '../../lib/utils';
import type { ToolView } from './message';
import { SubagentRowView } from './subagent-row';
import { useNow } from './use-elapsed';

type SubagentRunProps = {
  name: string;
  part: ToolView;
  /** A short tag beside the title, e.g. that the run continues in the background. */
  badge?: string;
};

/**
 * `run_subagents` / `message_subagent`: one card per call with a live row for
 * each subagent: what it is doing now, then its report.
 */
export function SubagentRun({ name, part, badge }: SubagentRunProps) {
  const view = subagentView(name, part);
  const now = useNow(view.running);

  return (
    <section
      aria-label={view.title}
      aria-busy={view.running}
      className="my-2 min-w-0 max-w-full overflow-hidden rounded-lg border border-border bg-card/40"
    >
      <header className="flex min-w-0 items-center gap-2 px-3 py-2 text-xs">
        {view.running
          ? <Loader2 aria-hidden className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
          : <Network aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{view.title}</span>
        {badge && (
          <span className="shrink-0 rounded border border-border px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            {badge}
          </span>
        )}
        <span className="shrink-0 tabular-nums text-muted-foreground" aria-live="polite">{view.summary}</span>
      </header>
      <ProgressBar rows={view.rows} running={view.running} />
      <ul className="divide-y divide-border border-t border-border">
        {view.rows.map((row) => (
          <li key={row.key}>
            <SubagentRowView row={row} single={view.rows.length === 1} now={now} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A thin segmented bar: one segment per subagent, filled as each finishes. */
function ProgressBar({ rows, running }: { rows: ReturnType<typeof subagentView>['rows']; running: boolean }) {
  if (!running || rows.length < 2) return null;

  return (
    <div className="flex gap-0.5 px-3 pb-2" aria-hidden>
      {rows.map((row) => (
        <span
          key={row.key}
          className={cn(
            'h-1 flex-1 rounded-full transition-colors duration-300',
            row.status === 'queued' && 'bg-muted',
            row.status === 'running' && 'bg-primary/40',
            row.status === 'completed' && 'bg-primary',
            row.status === 'incomplete' && 'bg-amber-500',
            row.status === 'failed' && 'bg-destructive',
          )}
        />
      ))}
    </div>
  );
}
