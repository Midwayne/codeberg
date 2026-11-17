import { useSessionSidebar, type SessionSidebarOptions } from './use-session-sidebar';
import { SidebarHeader } from './sidebar-header';
import { SidebarMenu, SidebarDelete } from './sidebar-actions';
import { SessionRow } from './session-row';
import { SidebarRename } from './rename-chat-dialog';

import type { SessionSummary } from '../../lib/sessions';

/** Chat organization is only a view over the same resumable conversations. */
type SessionSidebarProps = SessionSidebarOptions;

export function SessionSidebar(props: SessionSidebarProps) {
  const state = useSessionSidebar(props);

  return <SessionSidebarView {...state} />;
}

type SessionSidebarViewProps = ReturnType<typeof useSessionSidebar>;

function SessionSidebarView(state: SessionSidebarViewProps) {
  return (
    <aside
      id="chat-sidebar"
      className="flex min-h-0 w-full flex-1 flex-col bg-card/30 md:w-64 md:flex-none md:border-r md:border-border"
      aria-label="Chats"
    >
      <SidebarHeader state={state} />

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {state.visible.length === 0 && (
          <p className="px-2 py-4 text-xs text-muted-foreground">
            {state.view === 'archived' ? 'No archived chats yet.' : 'No saved chats yet.'}
          </p>
        )}
        <SessionGroups state={state} />
      </div>
      <SidebarMenu state={state} />
      <SidebarRename state={state} />
      <SidebarDelete state={state} />
    </aside>
  );
}

type SessionGroupsProps = { state: Parameters<typeof SessionSidebarView>[0] };

function SessionGroups({ state }: SessionGroupsProps) {
  return state.groups
    .filter((group) => group.items.length > 0)
    .map((group) => (
      <section key={group.label} aria-label={group.label} className="mb-1">
        <h2 className="px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground md:text-[11px]">{group.label}</h2>
        <ul className="space-y-px">
          {group.items.map((s) => (
            <SessionRow key={s.id} s={s} state={state} />
          ))}
        </ul>
      </section>
    ));
}

export type SidebarMenuProps = { state: Parameters<typeof SessionSidebarView>[0] };

export type SidebarDeleteProps = { state: Parameters<typeof SessionSidebarView>[0] };

export type SidebarRenameProps = { state: Parameters<typeof SessionSidebarView>[0] };

export type SessionRowProps = Pick<Parameters<typeof SessionGroups>[0], 'state'> & { s: SessionSummary };

export type SidebarHeaderProps = { state: Parameters<typeof SessionSidebarView>[0] };

export { DeleteChatDialog } from './sidebar-actions';

export { RenameChatDialog } from './rename-chat-dialog';

export { SessionActionsMenu } from './sidebar-actions';
