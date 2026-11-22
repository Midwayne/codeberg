import { Network } from 'lucide-react';

import { subagentView } from '../../lib/subagents';
import type { ToolView } from './message';

type SubagentStatusNoteProps = {
  name: string;
  part: ToolView;
};

/**
 * `background_tool_status` for a subagent job: one line, because the card
 * that started the job already shows each subagent's progress and report.
 */
export function SubagentStatusNote({ name, part }: SubagentStatusNoteProps) {
  const view = subagentView(name, part);
  const count = view.rows.length;
  const noun = `${count} background subagent${count === 1 ? '' : 's'}`;
  const title = view.running ? `Checked ${noun}` : `Read reports from ${noun}`;

  return (
    <div className="my-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <Network aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{title}</span>
      <span className="shrink-0 tabular-nums">{view.summary}</span>
    </div>
  );
}
