import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { useCallback, useEffect, useRef, useState } from 'react';

import { createChatBranch, isSessionSettled, type SessionAdopt } from '@/lib/branch';
import { useSessions } from '@/lib/use-sessions';
import { deleteSession, deriveTitle, loadSession, newSessionId, saveSession } from '@/lib/sessions';

/** Owns the conversation lifecycle shared by the chat and session sidebar. */
export function useWorkspaceSession() {
  const chat = useChat();
  const { sessions, refresh } = useSessions();
  const [sessionId, setSessionId] = useState(newSessionId);

  // Signature of the last conversation we persisted, so the save effect skips
  // re-writing an unchanged turn (notably the one we just resumed).
  const savedSig = useRef('');
  const seededRailPreview = useRef(false);
  // Title / parentId / id for the session we mean to persist. Kept in a ref so
  // a branch's "(branch)" title survives auto-save, and so we don't depend on
  // React state being in lockstep with useChat's message store.
  const persistMeta = useRef<{ id: string; parentId?: string; title?: string }>({
    id: sessionId,
  });
  const settle = useRef<SessionAdopt | null>(null);
  const signature = (id: string, msgs: { id?: string }[]) =>
    `${id}:${msgs.length}:${msgs.at(-1)?.id ?? ''}`;

  const adopt = useCallback(
    (id: string, messages: UIMessage[], nextParent?: string, title?: string) => {
      persistMeta.current = { id, parentId: nextParent, title };
      settle.current = { id, lastId: messages.at(-1)?.id ?? '' };
      savedSig.current = signature(id, messages);
      chat.setMessages(messages);
      setSessionId(id);
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
    if (!isSessionSettled(settle.current, sessionId, chat.messages)) return;
    settle.current = null;
    const meta = persistMeta.current;
    if (meta.id !== sessionId) return;
    const sig = signature(sessionId, chat.messages);
    if (sig === savedSig.current) return;
    savedSig.current = sig;
    void saveSession({
      id: sessionId,
      title: meta.title ?? deriveTitle(chat.messages),
      messages: chat.messages,
      parentId: meta.parentId,
    }).then(refresh);
  }, [chat.status, chat.messages, sessionId, refresh]);

  const resume = useCallback(
    async (id: string) => {
      const record = await loadSession(id);
      if (!record) {
        void refresh(); // it was deleted out from under us
        return;
      }
      adopt(record.id, record.messages, record.parentId, record.title);
    },
    [adopt, refresh],
  );

  const startNew = useCallback(() => {
    const id = newSessionId();
    persistMeta.current = { id };
    settle.current = null;
    savedSig.current = '';
    chat.setMessages([]);
    setSessionId(id);
  }, [chat]);

  const branchFrom = useCallback(
    async (throughIndex: number) => {
      if (chat.status !== 'ready' || chat.messages.length === 0 || throughIndex < 0) return;
      const sourceId = persistMeta.current.id || sessionId;
      const sourceMessages = chat.messages;
      // Persist the parent first so the lineage target exists on disk.
      await saveSession({
        id: sourceId,
        title: persistMeta.current.title ?? deriveTitle(sourceMessages),
        messages: sourceMessages,
        parentId: persistMeta.current.parentId,
      });
      const next = createChatBranch(sourceMessages, throughIndex, sourceId);
      adopt(next.id, next.messages, next.parentId, next.title);
      await saveSession(next);
      void refresh();
    },
    [chat, sessionId, adopt, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteSession(id);
      if (id === sessionId) startNew();
      void refresh();
    },
    [sessionId, startNew, refresh],
  );

  return { chat, sessions, sessionId, resume, startNew, branchFrom, remove };
}
