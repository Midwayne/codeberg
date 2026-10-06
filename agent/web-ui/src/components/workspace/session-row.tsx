import { GitBranch, MoreHorizontal } from 'lucide-react';

import { cn, timeAgo } from '../../lib/utils';
import { IconButton } from '../ui';
import { type SessionRowProps } from './session-sidebar';

export function SessionRow({ s, state }: SessionRowProps) {
  return (
    <li
      key={s.id}
      className={cn(
        'group/sess flex items-center gap-0.5 rounded-lg pr-1 text-sm transition-colors hover:bg-accent',
        s.id === state.currentId && 'bg-accent',
      )}
    >
      <button
        type="button"
        onClick={() => state.onResume(s.id)}
        aria-current={s.id === state.currentId ? 'true' : undefined}
        className="min-w-0 flex-1 px-2 py-3 text-left"
        title={s.title}
      >
        <span className="flex min-w-0 items-center gap-1">
          {s.parentId && <GitBranch className="size-3 shrink-0 text-muted-foreground" aria-label="Branched chat" />}
          <span className="line-clamp-2 leading-5 text-foreground">{s.title}</span>
        </span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">
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
            top: Math.max(8, Math.min(bounds.bottom, window.innerHeight - 124)),
            left: Math.max(8, bounds.right - 160),
          });
        }}
        aria-label={`Actions for ${s.title}`}
        aria-expanded={state.menu?.id === s.id}
        aria-haspopup="menu"
        className="hover:bg-background"
      >
        <MoreHorizontal className="size-4" />
      </IconButton>
    </li>
  );
}
