import { Chat } from '@/components/chat';
import { ChatSearch } from '@/components/chat-search';
import { SessionSidebar } from '@/components/session-sidebar';
import { useWorkspaceSession } from '@/sessions/use-workspace-session';
import { useState } from 'react';
import { deriveTitle } from '@/lib/sessions';

/**
 * Composes the chat and sidebar around the shared session lifecycle.
 */
export function Workspace({ sidebarOpen, learningEnabled, searchOpen, onSearchClose }: {
  sidebarOpen: boolean;
  learningEnabled: boolean;
  searchOpen: boolean;
  onSearchClose: () => void;
}) {
  const { chat, sessions, sessionId, sessionError, resume, startNew, branchFrom, remove, setFlags } = useWorkspaceSession();
  const [jump, setJump] = useState<{ sessionId: string; messageId: string; nonce: number }>();

  return (
    <div className="flex min-h-0 flex-1">
      {sidebarOpen && (
        <SessionSidebar
          sessions={sessions}
          error={sessionError}
          currentId={sessionId}
          canBranch={chat.status === 'ready' && chat.messages.length > 0}
          onResume={resume}
          onNew={startNew}
          onBranch={() => void branchFrom(chat.messages.length - 1)}
          onDelete={remove}
          onSetFlags={setFlags}
        />
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Chat chat={chat} sessionId={sessionId} learningEnabled={learningEnabled} onBranch={(index) => void branchFrom(index)} jump={jump?.sessionId === sessionId ? jump : undefined} />
      </div>
      <ChatSearch open={searchOpen} onClose={onSearchClose} currentId={sessionId} currentTitle={sessions.find((item) => item.id === sessionId)?.title ?? deriveTitle(chat.messages)} currentMessages={chat.messages} currentFlags={{ archived: sessions.find((item) => item.id === sessionId)?.archived ?? false, pinned: sessions.find((item) => item.id === sessionId)?.pinned ?? false }} onSelect={(id, messageId) => {
        if (messageId) setJump({ sessionId: id, messageId, nonce: Date.now() + Math.random() });
        void resume(id);
      }} />
    </div>
  );
}
