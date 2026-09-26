import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { useCallback, useEffect, useRef, useState } from 'react';

import { createChatBranch } from '@/lib/branch';
import { useSessions } from '@/lib/use-sessions';
import { deleteSession, deriveTitle, loadSession, newSessionId, saveSession, updateSessionFlags } from '@/lib/sessions';
import { createWorkspaceChat, type WorkspaceChat } from '@/sessions/workspace-chat';

/** Owns the conversation lifecycle shared by the chat and session sidebar. */
export function useWorkspaceSession() {
  const [sessionError, setSessionError] = useState('');
  const { sessions, refresh } = useSessions();
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const chats = useRef(new Map<string, WorkspaceChat>());
  const transitionIntent = useRef(0);
  const seededRailPreview = useRef(false);

  const createChat = useCallback(
    (id: string, messages: UIMessage[], parentId?: string, title?: string) => {
      const next = createWorkspaceChat({
        id,
        messages,
        parentId,
        title,
        persist: saveSession,
        onPersist: () => void refreshRef.current(),
      });
      chats.current.set(id, next);
      return next;
    },
    [],
  );
  const [active, setActive] = useState(() => createChat(newSessionId(), []));
  const chat = useChat({ chat: active.chat });
  const sessionId = active.id;

  // Dev-only: `?preview=rail` fills a tall transcript so the tick rail can be
  // exercised without a running model. Tree-shaken out of production builds.
  useEffect(() => {
    if (seededRailPreview.current) return;
    if (!import.meta.env.DEV) return;
    if (new URLSearchParams(window.location.search).get('preview') !== 'rail') return;
    seededRailPreview.current = true;
    void import('@/lib/rail-preview').then(({ RAIL_PREVIEW_MESSAGES }) => {
      active.chat.messages = RAIL_PREVIEW_MESSAGES;
    });
  }, [active]);

  const resume = useCallback(
    async (id: string) => {
      const intent = ++transitionIntent.current;
      const existing = chats.current.get(id);
      if (existing) {
        setActive(existing);
        return;
      }
      const record = await loadSession(id);
      if (intent !== transitionIntent.current) return;
      if (!record) {
        void refresh(); // it was deleted out from under us
        return;
      }
      setActive(createChat(record.id, record.messages, record.parentId, record.title));
    },
    [createChat, refresh],
  );

  const startNew = useCallback(() => {
    transitionIntent.current++;
    setActive(createChat(newSessionId(), []));
  }, [createChat]);

  const branchFrom = useCallback(
    async (throughIndex: number) => {
      if (chat.status !== 'ready' || chat.messages.length === 0 || throughIndex < 0) return;
      const intent = ++transitionIntent.current;
      const sourceId = active.id;
      const sourceMessages = chat.messages;
      // Persist the parent first so the lineage target exists on disk.
      await saveSession({
        id: sourceId,
        title: active.title ?? deriveTitle(sourceMessages),
        messages: sourceMessages,
        parentId: active.parentId,
      });
      const next = createChatBranch(sourceMessages, throughIndex, sourceId);
      await saveSession(next);
      void refresh();
      if (intent !== transitionIntent.current) return;
      setActive(createChat(next.id, next.messages, next.parentId, next.title));
    },
    [active, chat, createChat, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      transitionIntent.current++;
      const removed = chats.current.get(id);
      removed?.dispose();
      chats.current.delete(id);
      if (id === sessionId) startNew();
      await deleteSession(id);
      void refresh();
    },
    [sessionId, startNew, refresh],
  );

  const setFlags = useCallback(async (id: string, flags: { pinned?: boolean; archived?: boolean }) => {
    try {
      await updateSessionFlags(id, flags);
      setSessionError('');
      await refresh();
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'Could not update chat');
    }
  }, [refresh]);

  return { chat, sessions, sessionId, sessionError, resume, startNew, branchFrom, remove, setFlags };
}
