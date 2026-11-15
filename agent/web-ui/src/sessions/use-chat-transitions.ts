import type { UIMessage } from 'ai';
import { useCallback, useEffect } from 'react';
import { newSessionId } from '../lib/sessions';
import type { WorkspaceChat } from './workspace-chat';
import { createChatResume, type ChatLoad } from './chat-resume';
import { restoreChatSelection } from './chat-activation';

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
