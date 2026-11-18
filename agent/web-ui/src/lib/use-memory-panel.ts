import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';

import { loadMemory, removeProfileNote, type MemoryDashboard } from './memory';
import { useProjectApi } from './project-api';

const PENDING_POLL_MS = 5_000;

export function useMemoryPanel() {
  const { fetch: api } = useProjectApi();
  const [dashboard, setDashboard] = useState<MemoryDashboard>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;

    loadMemory(api)
      .then((next) => {
        if (cancelled) return;

        setDashboard(next);
        setError('');
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });

    return () => {
      cancelled = true;
    };
  }, [api, retry]);

  // Refresh while background saves are queued so new notes appear without a manual reload.
  useEffect(() => {
    if (!dashboard?.pending) return;

    const timer = setTimeout(() => setRetry((value) => value + 1), PENDING_POLL_MS);

    return () => clearTimeout(timer);
  }, [dashboard]);

  const remove = useRemoveNote(api, setDashboard, setError, setBusy);

  return { dashboard, error, busy, remove, refresh: () => setRetry((value) => value + 1) };
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
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setBusy(false);
      }
    },
    [api, setDashboard, setError, setBusy],
  );
}
