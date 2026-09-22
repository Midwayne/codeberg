import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Chat } from '@/components/chat';
import { SessionSidebar } from '@/components/session-sidebar';
import { createChatBranch } from '@/lib/branch';
import { useSessions } from '@/lib/use-sessions';
import { deleteSession, deriveTitle, loadSession, newSessionId, saveSession } from '@/lib/sessions';

/**
 * Owns the chat and its persistence. `useChat` lives here (not in `Chat`) so the
 * sidebar can drive it: resuming a saved chat replaces the messages, "New chat"
 * clears them, "Branch" copies a prefix into a new session. Each completed turn
 * is written back to the server keyed by the current session id.
 */
export function Workspace({ sidebarOpen }: { sidebarOpen: boolean }) {
  const chat = useChat();
  const { sessions, refresh } = useSessions();
  const [sessionId, setSessionId] = useState(newSessionId);
  const [parentId, setParentId] = useState<string | undefined>();

  // Signature of the last conversation we persisted, so the save effect skips
  // re-writing an unchanged turn (notably the one we just resumed).
  const savedSig = useRef('');
  const seededRailPreview = useRef(false);
  const signature = (id: string, msgs: { id: string }[]) =>
    `${id}:${msgs.length}:${msgs.at(-1)?.id ?? ''}`;

  const adopt = useCallback(
    (id: string, messages: UIMessage[], nextParent?: string) => {
      chat.setMessages(messages);
      setSessionId(id);
      setParentId(nextParent);
      savedSig.current = signature(id, messages);
    },
    [chat],
  );

  // Dev-only: `?preview=rail` fills a tall transcript so the tick rail can be
  // exercised without a running model. Tree-shaken out of production builds.
  useEffect(() => {
    if (seededRailPreview.current) return;
    if (!import.meta.env.DEV) return;
    if (new URLSearchParams(window.location.search).get('preview') !== 'rail') return;
    seededRailPreview.current = true;
    void import('@/lib/rail-preview').then(({ RAIL_PREVIEW_MESSAGES }) => {
      chat.setMessages(RAIL_PREVIEW_MESSAGES);
    });
  }, [chat]);

  // Persist once a turn settles (status back to "ready") and there's something
  // to save. PUT is idempotent, so the dedupe is just to avoid needless writes.
  useEffect(() => {
    if (chat.status !== 'ready' || chat.messages.length === 0) return;
    const sig = signature(sessionId, chat.messages);
    if (sig === savedSig.current) return;
    savedSig.current = sig;
    void saveSession({
      id: sessionId,
      title: deriveTitle(chat.messages),
      messages: chat.messages,
      parentId,
    }).then(refresh);
  }, [chat.status, chat.messages, sessionId, parentId, refresh]);

  const resume = useCallback(
    async (id: string) => {
      const record = await loadSession(id);
      if (!record) {
        void refresh(); // it was deleted out from under us
        return;
      }
      adopt(record.id, record.messages, record.parentId);
    },
    [adopt, refresh],
  );

  const startNew = useCallback(() => {
    chat.setMessages([]);
    setSessionId(newSessionId());
    setParentId(undefined);
    savedSig.current = '';
  }, [chat]);

  const branchFrom = useCallback(
    async (throughIndex: number) => {
      if (chat.status !== 'ready' || chat.messages.length === 0 || throughIndex < 0) return;
      const sourceId = sessionId;
      const sourceMessages = chat.messages;
      // Persist the parent first so the lineage target exists on disk.
      await saveSession({
        id: sourceId,
        title: deriveTitle(sourceMessages),
        messages: sourceMessages,
        parentId,
      });
      const next = createChatBranch(sourceMessages, throughIndex, sourceId);
      adopt(next.id, next.messages, next.parentId);
      await saveSession(next);
      void refresh();
    },
    [chat, sessionId, parentId, adopt, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteSession(id);
      if (id === sessionId) startNew();
      void refresh();
    },
    [sessionId, startNew, refresh],
  );

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
        <Chat chat={chat} onBranch={(index) => void branchFrom(index)} />
      </div>
    </div>
  );
}
