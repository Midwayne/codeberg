import type { SessionSummary } from '../../lib/sessions';
import type { ChatLoad } from '../../sessions/chat-resume';
import type { ChatReadiness } from '../../sessions/use-chat-readiness';
import { useChatMessagesWhile } from '../../sessions/use-chat-readiness';
import type { WorkspaceChat } from '../../sessions/workspace-chat';

import { ChatSearch } from './chat-search';
import { SessionSidebar } from './session-sidebar';

import { deriveTitle } from '../../lib/sessions';
import { emitSceneEvent } from '../../lib/scene/scene-events';

import { IconButton } from '../ui';
import { X } from 'lucide-react';

import type { useWorkspaceView, WorkspaceView } from './workspace';
import { useScheduleWorkspace } from '../../lib/schedule-workspace';
import { isActiveSchedule } from '../../lib/schedule-summary';

type WorkspaceSidebarProps = Pick<
  Parameters<typeof useWorkspaceView>[0],
  'projectControls' | 'onSidebarClose'
> & {
  desktop: boolean;
  sessions: SessionSummary[];
  sessionError: string;
  load?: ChatLoad;
  sessionId: string;
  active: WorkspaceChat;
  readiness: ChatReadiness;
  resume: (id: string) => Promise<void>;
  startNew: () => void;
  branchFrom: (throughIndex: number) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setFlags: (id: string, flags: { pinned?: boolean; archived?: boolean }) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
};

export function WorkspaceSidebar({
  projectControls,
  desktop,
  onSidebarClose,
  sessions,
  sessionError,
  load,
  sessionId,
  active,
  readiness,
  resume,
  startNew,
  branchFrom,
  remove,
  setFlags,
  rename,
}: WorkspaceSidebarProps) {
  const schedules = useScheduleWorkspace();

  return (
    <SessionSidebar
      scheduledChatIds={new Set(schedules?.jobs?.filter(isActiveSchedule).map((job) => job.chatId))}
      projectControls={projectControls}
      sidebarActions={!desktop && <CloseChatsButton onClick={onSidebarClose} />}
      sessions={sessions}
      error={sessionError}
      currentId={load?.id ?? sessionId}
      canBranch={!load && readiness.status === 'ready' && readiness.hasMessages}
      onResume={(id) => {
        void resume(id);
        if (!desktop) onSidebarClose();
      }}
      onNew={() => {
        startNew();
        emitSceneEvent('new-chat');
        if (!desktop) onSidebarClose();
      }}
      onBranch={() => {
        void branchFrom(active.chat.messages.length - 1);
        if (!desktop) onSidebarClose();
      }}
      onDelete={remove}
      onSetFlags={setFlags}
      onRename={rename}
    />
  );
}

function CloseChatsButton({ onClick }: { onClick: () => void }) {
  return (
    <IconButton aria-label="Close chats" onClick={onClick}>
      <X className="size-4" />
    </IconButton>
  );
}

type WorkspaceSearchProps = Pick<
  Parameters<typeof WorkspaceView>[0],
  'searchOpen' | 'onSearchClose' | 'sessionId' | 'sessions' | 'active' | 'setJump' | 'resume'
>;

export function WorkspaceSearch({
  searchOpen,
  onSearchClose,
  sessionId,
  sessions,
  active,
  setJump,
  resume,
}: WorkspaceSearchProps) {
  // Follow the streaming transcript only while search is open.
  const messages = useChatMessagesWhile(active.chat, searchOpen);

  return (
    <ChatSearch
      open={searchOpen}
      onClose={onSearchClose}
      currentId={sessionId}
      currentTitle={sessions.find((item) => item.id === sessionId)?.title ?? deriveTitle(messages)}
      currentMessages={messages}
      currentFlags={{
        archived: sessions.find((item) => item.id === sessionId)?.archived ?? false,
        pinned: sessions.find((item) => item.id === sessionId)?.pinned ?? false,
      }}
      onSelect={(id, messageId) => {
        if (messageId) setJump({ sessionId: id, messageId, nonce: Date.now() + Math.random() });
        void resume(id);
      }}
    />
  );
}
