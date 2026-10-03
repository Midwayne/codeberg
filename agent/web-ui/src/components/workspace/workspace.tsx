import { Chat } from '@/components/chat/chat';
import { ChatSearch } from './chat-search';
import { SessionSidebar } from './session-sidebar';
import { useWorkspaceSession } from '@/sessions/use-workspace-session';
import { useState, type ReactNode } from 'react';
import { deriveTitle } from '@/lib/sessions';
import type { CatalogModel } from '@/lib/models';
import { Dialog, IconButton } from '@/components/ui';
import { X } from 'lucide-react';
import { useMediaQuery } from '@/lib/use-media-query';

/**
 * Composes the chat and sidebar around the shared session lifecycle.
 */
export function Workspace({ projectControls, sidebarOpen, onSidebarClose, learningEnabled, chatInputs, searchOpen, onSearchClose }: {
  projectControls?: ReactNode;
  sidebarOpen: boolean;
  onSidebarClose: () => void;
  learningEnabled: boolean;
  chatInputs: CatalogModel['inputs'];
  searchOpen: boolean;
  onSearchClose: () => void;
}) {
  const { chat, sessions, sessionId, sessionError, resume, startNew, branchFrom, remove, setFlags } = useWorkspaceSession();
  const [jump, setJump] = useState<{ sessionId: string; messageId: string; nonce: number }>();
  const desktop = useMediaQuery('(min-width: 768px)');
  const sidebar = <SessionSidebar
    projectControls={projectControls}
    sidebarActions={!desktop && <IconButton aria-label="Close chats" onClick={onSidebarClose}><X className="size-4" /></IconButton>}
    sessions={sessions} error={sessionError} currentId={sessionId}
    canBranch={chat.status === 'ready' && chat.messages.length > 0}
    onResume={(id) => { void resume(id); if (!desktop) onSidebarClose(); }}
    onNew={() => { startNew(); if (!desktop) onSidebarClose(); }}
    onBranch={() => { void branchFrom(chat.messages.length - 1); if (!desktop) onSidebarClose(); }}
    onDelete={remove} onSetFlags={setFlags}
  />;

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {desktop && sidebarOpen && sidebar}
      {!desktop && <Dialog open={sidebarOpen} label="Projects and chats" onClose={onSidebarClose}
        className="m-0 h-dvh max-h-none w-[min(20rem,calc(100vw-3rem))] max-w-none rounded-none border-r border-border bg-card shadow-none">
        {sidebar}
      </Dialog>}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Chat chat={chat} sessionId={sessionId} learningEnabled={learningEnabled} chatInputs={chatInputs} onBranch={(index) => void branchFrom(index)} jump={jump?.sessionId === sessionId ? jump : undefined} />
      </div>
      <ChatSearch open={searchOpen} onClose={onSearchClose} currentId={sessionId} currentTitle={sessions.find((item) => item.id === sessionId)?.title ?? deriveTitle(chat.messages)} currentMessages={chat.messages} currentFlags={{ archived: sessions.find((item) => item.id === sessionId)?.archived ?? false, pinned: sessions.find((item) => item.id === sessionId)?.pinned ?? false }} onSelect={(id, messageId) => {
        if (messageId) setJump({ sessionId: id, messageId, nonce: Date.now() + Math.random() });
        void resume(id);
      }} />
    </div>
  );
}
