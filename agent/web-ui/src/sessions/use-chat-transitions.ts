import { type UseChatHelpers } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { useCallback, useEffect } from 'react';
import { createChatBranch } from '../lib/branch';

import { deriveTitle, newSessionId, saveSession } from '../lib/sessions';
import { type WorkspaceChat } from './workspace-chat';
import { createChatResume, type ChatLoad } from './chat-resume';
import { restoreChatSelection } from './chat-activation';

export type ChatBranchOptions = {
  chat: UseChatHelpers<UIMessage>;
  transitionIntent: React.RefObject<number>;
  active: WorkspaceChat;
  api: typeof fetch;
  refresh: () => Promise<void>;
  setActive: React.Dispatch<React.SetStateAction<WorkspaceChat>>;
  createChat: (id: string, messages: UIMessage[], parentId?: string, title?: string) => WorkspaceChat;
  setSessionError: (error: string) => void;
};

export function useChatBranch({
  chat,
  transitionIntent,
  active,
  api,
  refresh,
  setActive,
  createChat,
  setSessionError,
}: ChatBranchOptions) {
  const branchFrom = useCallback(
    async (throughIndex: number) => {
      if (chat.status !== 'ready' || chat.messages.length === 0 || throughIndex < 0) return;
      const intent = ++transitionIntent.current;
      const sourceId = active.id;
      const sourceMessages = chat.messages;

      try {
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
      } catch (error) {
        setSessionError(error instanceof Error ? error.message : 'Could not branch chat.');
      }
    },
    [active, chat, createChat, refresh, api, setSessionError],
  );

  return { branchFrom };
}

export type ChatTransitionsOptions = {
  transitionIntent: React.RefObject<number>;
  chats: React.RefObject<Map<string, WorkspaceChat>>;
  renderedViews: React.RefObject<ReadonlySet<WorkspaceChat>>;
  setActive: React.Dispatch<React.SetStateAction<WorkspaceChat>>;
  setLoad: React.Dispatch<React.SetStateAction<ChatLoad | undefined>>;
  api: typeof fetch;
  refresh: () => Promise<void>;
  createChat: (id: string, messages: UIMessage[], parentId?: string, title?: string) => WorkspaceChat;
  sessionId: string;
};

export function useChatTransitions(options: ChatTransitionsOptions) {
  const { transitionIntent, chats, renderedViews, setActive, setLoad, api, refresh, createChat, sessionId } = options;

  useEffect(() => () => {
    transitionIntent.current++;
  }, [transitionIntent]);

  const resume = useCallback(createChatResume(options), [transitionIntent, chats, renderedViews, setActive, setLoad, api, refresh, createChat, sessionId]);

  const cancelResume = useCallback(() => {
    transitionIntent.current++;

    restoreChatSelection(options);
    setLoad(undefined);
  }, [transitionIntent, chats, sessionId, setActive, setLoad]);

  const startNew = useCallback(() => {
    cancelResume();
    setActive(createChat(newSessionId(), []));
  }, [createChat, cancelResume, setActive]);

  useStorageCleanup({ cancelResume, chats, sessionId, startNew, refresh });

  return { startNew, resume, cancelResume };
}

type StorageCleanupOptions = Pick<ChatTransitionsOptions, 'chats' | 'sessionId' | 'refresh'> & {
  startNew: () => void;
  cancelResume: () => void;
};

function useStorageCleanup({ cancelResume, chats, sessionId, startNew, refresh }: StorageCleanupOptions) {
  useEffect(() => {
    const cleaned = (event: Event) => {
      cancelResume();

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
  }, [sessionId, startNew, refresh, cancelResume, chats]);
}
