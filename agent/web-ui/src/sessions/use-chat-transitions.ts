import { type UseChatHelpers } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { useCallback, useEffect } from 'react';
import { createChatBranch } from '../lib/branch';

import { deriveTitle, loadSession, newSessionId, saveSession } from '../lib/sessions';
import { type WorkspaceChat } from './workspace-chat';

export type ChatBranchOptions = {
  chat: UseChatHelpers<UIMessage>;
  transitionIntent: React.RefObject<number>;
  active: WorkspaceChat;
  api: typeof fetch;
  refresh: () => Promise<void>;
  setActive: React.Dispatch<React.SetStateAction<WorkspaceChat>>;
  createChat: (id: string, messages: UIMessage[], parentId?: string, title?: string) => WorkspaceChat;
};

export function useChatBranch({
  chat,
  transitionIntent,
  active,
  api,
  refresh,
  setActive,
  createChat,
}: ChatBranchOptions) {
  const branchFrom = useCallback(
    async (throughIndex: number) => {
      if (chat.status !== 'ready' || chat.messages.length === 0 || throughIndex < 0) return;
      const intent = ++transitionIntent.current;
      const sourceId = active.id;
      const sourceMessages = chat.messages;
      // Persist the parent first so the lineage target exists on disk.
      await saveSession(
        {
          id: sourceId,
          title: active.title ?? deriveTitle(sourceMessages),
          messages: sourceMessages,
          parentId: active.parentId,
        },
        api,
      );
      const next = createChatBranch(sourceMessages, throughIndex, sourceId);
      await saveSession(next, api);
      void refresh();
      if (intent !== transitionIntent.current) return;
      setActive(createChat(next.id, next.messages, next.parentId, next.title));
    },
    [active, chat, createChat, refresh, api],
  );

  return { branchFrom };
}

export type ChatTransitionsOptions = {
  transitionIntent: React.RefObject<number>;
  chats: React.RefObject<Map<string, WorkspaceChat>>;
  setActive: React.Dispatch<React.SetStateAction<WorkspaceChat>>;
  api: typeof fetch;
  refresh: () => Promise<void>;
  createChat: (id: string, messages: UIMessage[], parentId?: string, title?: string) => WorkspaceChat;
  sessionId: string;
};

export function useChatTransitions({
  transitionIntent,
  chats,
  setActive,
  api,
  refresh,
  createChat,
  sessionId,
}: ChatTransitionsOptions) {
  const resume = useCallback(
    async (id: string) => {
      const intent = ++transitionIntent.current;
      const existing = chats.current.get(id);
      if (existing) {
        setActive(existing);
        return;
      }
      const record = await loadSession(id, api);
      if (intent !== transitionIntent.current) return;
      if (!record) {
        void refresh(); // it was deleted out from under us
        return;
      }
      setActive(createChat(record.id, record.messages, record.parentId, record.title));
    },
    [createChat, refresh, api],
  );

  const startNew = useCallback(() => {
    transitionIntent.current++;
    setActive(createChat(newSessionId(), []));
  }, [createChat]);

  useEffect(() => {
    const cleaned = (event: Event) => {
      const ids = (event as CustomEvent<{ deletedChatIds?: string[] }>).detail?.deletedChatIds ?? [];
      for (const id of ids) {
        chats.current.get(id)?.dispose();
        chats.current.delete(id);
      }
      if (ids.includes(sessionId)) startNew();
      void refresh();
    };
    window.addEventListener('codeberg:storage-cleaned', cleaned);
    return () => window.removeEventListener('codeberg:storage-cleaned', cleaned);
  }, [sessionId, startNew, refresh, api]);

  return { startNew, resume };
}
