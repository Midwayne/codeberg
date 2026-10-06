import type { UseChatHelpers } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { type SessionSummary } from '../../lib/sessions';

import { ChatSearch } from './chat-search';
import { SessionSidebar } from './session-sidebar';

import { deriveTitle } from '../../lib/sessions';

import { IconButton } from '../ui';
import { X } from 'lucide-react';

import { type useWorkspaceView, type WorkspaceView } from './workspace';

export type WorkspaceSidebarProps = Pick<
  Parameters<typeof useWorkspaceView>[0],
  'projectControls' | 'onSidebarClose'
> & {
  desktop: boolean;
  sessions: SessionSummary[];
  sessionError: string;
  sessionId: string;
  chat: UseChatHelpers<UIMessage>;
  resume: (id: string) => Promise<void>;
  startNew: () => void;
  branchFrom: (throughIndex: number) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setFlags: (id: string, flags: { pinned?: boolean; archived?: boolean }) => Promise<void>;
};

export function WorkspaceSidebar({
  projectControls,
  desktop,
  onSidebarClose,
  sessions,
  sessionError,
  sessionId,
  chat,
  resume,
  startNew,
  branchFrom,
  remove,
  setFlags,
}: WorkspaceSidebarProps) {
  return (
    <SessionSidebar
      projectControls={projectControls}
      sidebarActions={
        !desktop && (
          <IconButton aria-label="Close chats" onClick={onSidebarClose}>
            <X className="size-4" />
          </IconButton>
        )
      }
      sessions={sessions}
      error={sessionError}
      currentId={sessionId}
      canBranch={chat.status === 'ready' && chat.messages.length > 0}
      onResume={(id) => {
        void resume(id);
        if (!desktop) onSidebarClose();
      }}
      onNew={() => {
        startNew();
        if (!desktop) onSidebarClose();
      }}
      onBranch={() => {
        void branchFrom(chat.messages.length - 1);
        if (!desktop) onSidebarClose();
      }}
      onDelete={remove}
      onSetFlags={setFlags}
    />
  );
}

export type WorkspaceSearchProps = Pick<
  Parameters<typeof WorkspaceView>[0],
  'searchOpen' | 'onSearchClose' | 'sessionId' | 'sessions' | 'chat' | 'setJump' | 'resume'
>;

export function WorkspaceSearch({
  searchOpen,
  onSearchClose,
  sessionId,
  sessions,
  chat,
  setJump,
  resume,
}: WorkspaceSearchProps) {
  return (
    <ChatSearch
      open={searchOpen}
      onClose={onSearchClose}
      currentId={sessionId}
      currentTitle={sessions.find((item) => item.id === sessionId)?.title ?? deriveTitle(chat.messages)}
      currentMessages={chat.messages}
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
