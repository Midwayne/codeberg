import { useCallback } from 'react';

import { deleteSession, updateSessionFlags } from '../lib/sessions';
import { type WorkspaceChat } from './workspace-chat';

export type SessionMutationsOptions = {
  cancelResume: () => void;
  chats: React.RefObject<Map<string, WorkspaceChat>>;
  sessionId: string;
  startNew: () => void;
  api: typeof fetch;
  refresh: () => Promise<void>;
  setSessionError: React.Dispatch<React.SetStateAction<string>>;
};

export function useSessionMutations({
  cancelResume,
  chats,
  sessionId,
  startNew,
  api,
  refresh,
  setSessionError,
}: SessionMutationsOptions) {
  const remove = useCallback(
    async (id: string) => {
      cancelResume();
      const removed = chats.current.get(id);
      const settled = removed?.dispose();
      if (id === sessionId) startNew();

      try {
        await settled;
        await deleteSession(id, api);
        setSessionError('');
      } catch (error) {
        setSessionError(error instanceof Error ? error.message : 'Could not delete chat.');
      } finally {
        chats.current.delete(id);
        void refresh();
      }
    },
    [sessionId, startNew, refresh, api, setSessionError, cancelResume],
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
