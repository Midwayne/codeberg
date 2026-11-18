import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import { errorMessage } from '@agent/core/errors.js';

import { loadMemory, removeProfileNote, type MemoryDashboard } from './memory';
import { startPoll, type Poll } from './poll';
import { useProjectApi } from './project-api';

/** Refresh while saves are queued so new notes appear; each refresh reads every saved finding. */
const PENDING_POLL_MS = 10_000;

export function useMemoryPanel() {
  const { fetch: api } = useProjectApi();
  const [dashboard, setDashboard] = useState<MemoryDashboard>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const poll = useRef<Poll>(undefined);

  useEffect(() => {
    poll.current = startPoll({
      load: (signal) => loadMemory(api, signal),
      timeoutMs: 10_000,
      done: (next) => {
        setDashboard(next);
        setError('');

        return next.pending ? PENDING_POLL_MS : undefined;
      },
      fail: (reason) => {
        setError(errorMessage(reason));

        return undefined;
      },
    });

    return () => poll.current?.stop();
  }, [api]);

  const remove = useRemoveNote(api, setDashboard, setError, setBusy);

  return { dashboard, error, busy, remove, refresh: () => poll.current?.wake() };
}

function useRemoveNote(
  api: typeof fetch,
  setDashboard: Dispatch<SetStateAction<MemoryDashboard | undefined>>,
  setError: (error: string) => void,
  setBusy: (busy: boolean) => void,
) {
  return useCallback(
    async (id: string) => {
      setBusy(true);

      try {
        await removeProfileNote(id, api);
        setDashboard((current) => current && { ...current, profile: current.profile.filter((note) => note.id !== id) });
      } catch (reason) {
        setError(errorMessage(reason));
      } finally {
        setBusy(false);
      }
    },
    [api, setDashboard, setError, setBusy],
  );
}
