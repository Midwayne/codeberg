import { Clock, GitBranch, MoreHorizontal } from 'lucide-react';

import { cn, timeAgo } from '../../lib/utils';
import { IconButton } from '../ui';
import type { SessionRowProps } from './session-sidebar';

export function SessionRow({ s, state }: SessionRowProps) {
  return (
    <li
      key={s.id}
      className={cn(
        'group/sess flex items-center gap-0.5 rounded-md pr-1 text-sm transition-colors hover:bg-accent md:text-[13px]',
        s.id === state.currentId && 'bg-accent',
      )}
    >
      <button
        type="button"
        onClick={() => state.onResume(s.id)}
        aria-current={s.id === state.currentId ? 'true' : undefined}
        className="min-w-0 flex-1 px-2 py-3 text-left md:py-1.5"
        title={s.title}
      >
        <span className="flex min-w-0 items-center gap-1">
          {s.parentId && <GitBranch className="size-3 shrink-0 text-muted-foreground" aria-label="Branched chat" />}
          <ScheduleBadge active={state.scheduledChatIds?.has(s.id)} />
          <span className="line-clamp-2 leading-5 text-foreground md:line-clamp-1">{s.title}</span>
        </span>
        <span className="mt-1 block truncate text-xs text-muted-foreground md:mt-0 md:text-[11px] md:leading-4">
          {timeAgo(s.updatedAt)} · {s.turns} turn{s.turns === 1 ? '' : 's'}
        </span>
      </button>
      <IconButton
        onClick={(event) => {
          if (state.menu?.id === s.id) {
            state.setMenu(undefined);
            return;
          }
          state.triggerRef.current = event.currentTarget;
          const bounds = event.currentTarget.getBoundingClientRect();
          state.setMenu({
            id: s.id,
            top: Math.max(8, Math.min(bounds.bottom, window.innerHeight - 140)),
            left: Math.max(8, bounds.right - 144),
          });
        }}
        aria-label={`Actions for ${s.title}`}
        aria-expanded={state.menu?.id === s.id}
        aria-haspopup="menu"
        className={cn(ROW_ACTIONS, s.id === state.currentId && 'pointer-fine:opacity-100')}
      >
        <MoreHorizontal className="size-4 md:size-3.5" />
      </IconButton>
    </li>
  );
}

/** Mouse users reveal row actions on hover; touch keeps them visible. */
const ROW_ACTIONS =
  'hover:bg-background md:size-6 pointer-fine:opacity-0 pointer-fine:group-hover/sess:opacity-100 pointer-fine:focus-visible:opacity-100 pointer-fine:aria-expanded:opacity-100';

function ScheduleBadge({ active }: { active?: boolean }) {
  return active && <span role="img" aria-label="Has active scheduled runs or background tools" title="Has active scheduled runs or background tools" className="shrink-0 text-muted-foreground">
    <Clock className="size-3" aria-hidden="true" />
  </span>;
}
