import { useSessionSidebar } from './use-session-sidebar';
import { SidebarHeader } from './sidebar-header';
import { SidebarMenu, SidebarDelete } from './sidebar-actions';
import { SessionRow } from './session-row';

import { type ReactNode } from 'react';

import { type SessionSummary } from '../../lib/sessions';

/** Chat organization is only a view over the same resumable conversations. */
export type SessionSidebarProps = {
  projectControls?: ReactNode;
  sidebarActions?: ReactNode;
  sessions: SessionSummary[];
  error?: string;
  currentId: string;
  canBranch: boolean;
  onResume: (id: string) => void;
  onNew: () => void;
  onBranch: () => void;
  onDelete: (id: string) => void;
  onSetFlags: (id: string, flags: { pinned?: boolean; archived?: boolean }) => void;
};

export function SessionSidebar(props: SessionSidebarProps) {
  const state = useSessionSidebar(props);

  return <SessionSidebarView {...state} />;
}

export type SessionSidebarViewProps = ReturnType<typeof useSessionSidebar>;

function SessionSidebarView(state: SessionSidebarViewProps) {
  return (
    <aside
      id="chat-sidebar"
      className="flex min-h-0 w-full flex-1 flex-col bg-card/30 md:w-72 md:flex-none md:border-r md:border-border"
      aria-label="Chats"
    >
      <SidebarHeader state={state} />

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {state.visible.length === 0 && (
          <p className="px-2 py-4 text-xs text-muted-foreground">
            {state.view === 'archived' ? 'No archived chats yet.' : 'No saved chats yet.'}
          </p>
        )}
        <SessionGroups state={state} />
      </div>
      <SidebarMenu state={state} />
      <SidebarDelete state={state} />
    </aside>
  );
}

export type SessionGroupsProps = { state: Parameters<typeof SessionSidebarView>[0] };

function SessionGroups({ state }: SessionGroupsProps) {
  return state.groups
    .filter((group) => group.items.length > 0)
    .map((group) => (
      <section key={group.label} aria-label={group.label} className="mb-3">
        <h2 className="px-2 pt-4 pb-2 text-xs font-medium text-muted-foreground">{group.label}</h2>
        <ul className="space-y-0.5">
          {group.items.map((s) => (
            <SessionRow key={s.id} s={s} state={state} />
          ))}
        </ul>
      </section>
    ));
}

export type SidebarMenuProps = { state: Parameters<typeof SessionSidebarView>[0] };

export type SidebarDeleteProps = { state: Parameters<typeof SessionSidebarView>[0] };

export type SessionRowProps = Pick<Parameters<typeof SessionGroups>[0], 'state'> & { s: SessionSummary };

export type SidebarHeaderProps = { state: Parameters<typeof SessionSidebarView>[0] };

export { DeleteChatDialog } from './sidebar-actions';

export { SessionActionsMenu } from './sidebar-actions';
