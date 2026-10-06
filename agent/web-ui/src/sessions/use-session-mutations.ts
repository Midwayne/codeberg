import { useCallback } from 'react';

import { deleteSession, updateSessionFlags } from '../lib/sessions';
import { type WorkspaceChat } from './workspace-chat';

export type SessionMutationsOptions = {
  transitionIntent: React.RefObject<number>;
  chats: React.RefObject<Map<string, WorkspaceChat>>;
  sessionId: string;
  startNew: () => void;
  api: typeof fetch;
  refresh: () => Promise<void>;
  setSessionError: React.Dispatch<React.SetStateAction<string>>;
};

export function useSessionMutations({
  transitionIntent,
  chats,
  sessionId,
  startNew,
  api,
  refresh,
  setSessionError,
}: SessionMutationsOptions) {
  const remove = useCallback(
    async (id: string) => {
      transitionIntent.current++;
      const removed = chats.current.get(id);
      removed?.dispose();
      chats.current.delete(id);
      if (id === sessionId) startNew();
      await deleteSession(id, api);
      void refresh();
    },
    [sessionId, startNew, refresh, api],
  );

  const setFlags = useCallback(
    async (id: string, flags: { pinned?: boolean; archived?: boolean }) => {
      try {
        await updateSessionFlags(id, flags, api);
        setSessionError('');
        await refresh();
      } catch (error) {
        setSessionError(error instanceof Error ? error.message : 'Could not update chat');
      }
    },
    [refresh, api],
  );

  return { remove, setFlags };
}
