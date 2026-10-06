import { GitBranch, MessageSquarePlus } from 'lucide-react';

import { cn } from '../../lib/utils';
import { IconButton } from '../ui';
import { type SidebarHeaderProps } from './session-sidebar';

export function SidebarHeader({ state }: SidebarHeaderProps) {
  return (
    <div className="space-y-4 p-3">
      <div className="flex min-w-0 items-center gap-1">
        {state.projectControls}
        {state.sidebarActions}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={state.onNew}
          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <MessageSquarePlus className="size-4" />
          New chat
        </button>
        <IconButton
          onClick={state.onBranch}
          disabled={!state.canBranch}
          aria-label="Branch chat"
          title="Copy this chat into a new session"
          className="size-11 border border-border sm:size-11"
        >
          <GitBranch className="size-4" />
        </IconButton>
      </div>
      <SidebarViewTabs state={state} />
      {state.error && (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      )}
    </div>
  );
}

export type SidebarViewTabsProps = Pick<Parameters<typeof SidebarHeader>[0], 'state'>;

export function SidebarViewTabs({ state }: SidebarViewTabsProps) {
  return (
    <div className="flex gap-1 rounded-lg bg-muted/50 p-1" role="group" aria-label="Chat view">
      {(['active', 'archived'] as const).map((name) => (
        <button
          key={name}
          type="button"
          onClick={() => state.setView(name)}
          aria-pressed={state.view === name}
          className={cn(
            'min-h-10 flex-1 rounded-md px-2 py-2 text-xs capitalize hover:bg-accent',
            state.view === name ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground',
          )}
        >
          {name}
          <span className="ml-2 tabular-nums opacity-70">
            {state.sessions.filter((session) => session.archived === (name === 'archived')).length}
          </span>
        </button>
      ))}
    </div>
  );
}
