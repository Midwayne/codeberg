import { Chat } from '@/components/chat';
import { SessionSidebar } from '@/components/session-sidebar';
import { useWorkspaceSession } from '@/sessions/use-workspace-session';

/**
 * Composes the chat and sidebar around the shared session lifecycle.
 */
export function Workspace({ sidebarOpen, learningEnabled }: { sidebarOpen: boolean; learningEnabled: boolean }) {
  const { chat, sessions, sessionId, resume, startNew, branchFrom, remove } = useWorkspaceSession();

  return (
    <div className="flex min-h-0 flex-1">
      {sidebarOpen && (
        <SessionSidebar
          sessions={sessions}
          currentId={sessionId}
          canBranch={chat.status === 'ready' && chat.messages.length > 0}
          onResume={resume}
          onNew={startNew}
          onBranch={() => void branchFrom(chat.messages.length - 1)}
          onDelete={remove}
        />
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Chat chat={chat} sessionId={sessionId} learningEnabled={learningEnabled} onBranch={(index) => void branchFrom(index)} />
      </div>
    </div>
  );
}
