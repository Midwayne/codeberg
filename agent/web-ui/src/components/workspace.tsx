import { useChat } from '@ai-sdk/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Chat } from '@/components/chat';
import { SessionSidebar } from '@/components/session-sidebar';
import { blankSession, createChatBranch, type OpenSession } from '@/lib/branch';
import { useSessions } from '@/lib/use-sessions';
import { deleteSession, deriveTitle, loadSession, saveSession } from '@/lib/sessions';

/**
 * Owns which chat is open. The live `useChat` store lives in `ChatSession`,
 * which remounts when the session id changes, so the transcript, the id, and
 * the title are always the same value — resume, new, and branch are one
 * `setSession`.
 */
export function Workspace({ sidebarOpen }: { sidebarOpen: boolean }) {
  const { sessions, refresh } = useSessions();
  const [session, setSession] = useState<OpenSession>(() => blankSession());
  const [canBranch, setCanBranch] = useState(false);
  const branchLatest = useRef<() => void>(() => {});
  const seededPreview = useRef(false);

  const claimPreview = useCallback(() => {
    if (seededPreview.current || !import.meta.env.DEV) return false;
    if (new URLSearchParams(window.location.search).get('preview') !== 'rail') return false;
    seededPreview.current = true;
    return true;
  }, []);

  const resume = useCallback(
    async (id: string) => {
      const record = await loadSession(id);
      if (!record) {
        void refresh();
        return;
      }
      setSession({
        id: record.id,
        title: record.title,
        parentId: record.parentId,
        messages: record.messages,
      });
    },
    [refresh],
  );

  const startNew = useCallback(() => {
    setSession(blankSession());
  }, []);

  const remove = useCallback(
    async (id: string) => {
      await deleteSession(id);
      if (id === session.id) setSession(blankSession());
      void refresh();
    },
    [session.id, refresh],
  );

  return (
    <div className="flex min-h-0 flex-1">
      {sidebarOpen && (
        <SessionSidebar
          sessions={sessions}
          currentId={session.id}
          canBranch={canBranch}
          onResume={(id) => void resume(id)}
          onNew={startNew}
          onBranch={() => branchLatest.current()}
          onDelete={(id) => void remove(id)}
        />
      )}
      <ChatSession
        key={session.id}
        session={session}
        claimPreview={claimPreview}
        onOpen={setSession}
        onRefresh={refresh}
        onCanBranch={setCanBranch}
        branchLatest={branchLatest}
      />
    </div>
  );
}

function transcriptSig(messages: readonly { id?: string }[]): string {
  return `${messages.length}:${messages.at(-1)?.id ?? ''}`;
}

/**
 * One mounted chat. `key={session.id}` on the parent means this component is
 * born with its transcript; it never has to reconcile a new id against the
 * previous message list.
 */
function ChatSession({
  session,
  claimPreview,
  onOpen,
  onRefresh,
  onCanBranch,
  branchLatest,
}: {
  session: OpenSession;
  claimPreview: () => boolean;
  onOpen: (next: OpenSession) => void;
  onRefresh: () => Promise<void> | void;
  onCanBranch: (value: boolean) => void;
  branchLatest: { current: () => void };
}) {
  const chat = useChat({ id: session.id, messages: session.messages });
  const savedSig = useRef(transcriptSig(session.messages));

  useEffect(() => {
    if (!claimPreview()) return;
    void import('@/lib/rail-preview').then(({ RAIL_PREVIEW_MESSAGES }) => {
      chat.setMessages(RAIL_PREVIEW_MESSAGES);
    });
  }, [chat, claimPreview]);

  useEffect(() => {
    onCanBranch(chat.status === 'ready' && chat.messages.length > 0);
  }, [chat.status, chat.messages.length, onCanBranch]);

  useEffect(() => {
    return () => onCanBranch(false);
  }, [onCanBranch]);

  const branchFrom = useCallback(
    async (throughIndex: number) => {
      if (chat.status !== 'ready' || chat.messages.length === 0 || throughIndex < 0) return;
      const sourceMessages = chat.messages;
      await saveSession({
        id: session.id,
        title: session.title ?? deriveTitle(sourceMessages),
        messages: sourceMessages,
        parentId: session.parentId,
      });
      const next = createChatBranch(sourceMessages, throughIndex, session.id);
      await saveSession(next);
      onOpen({
        id: next.id,
        title: next.title,
        parentId: next.parentId,
        messages: next.messages,
      });
      void onRefresh();
    },
    [chat, session.id, session.title, session.parentId, onOpen, onRefresh],
  );

  useEffect(() => {
    branchLatest.current = () => {
      void branchFrom(chat.messages.length - 1);
    };
    return () => {
      branchLatest.current = () => {};
    };
  }, [branchFrom, branchLatest, chat.messages.length]);

  // Persist once a turn settles. The signature starts at the transcript this
  // session was opened with, so a resume or branch does not rewrite itself.
  useEffect(() => {
    if (chat.status !== 'ready' || chat.messages.length === 0) return;
    const sig = transcriptSig(chat.messages);
    if (sig === savedSig.current) return;
    savedSig.current = sig;
    void saveSession({
      id: session.id,
      title: session.title ?? deriveTitle(chat.messages),
      messages: chat.messages,
      parentId: session.parentId,
    }).then(() => onRefresh());
  }, [chat.status, chat.messages, session.id, session.title, session.parentId, onRefresh]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Chat chat={chat} onBranch={(index) => void branchFrom(index)} />
    </div>
  );
}
