import { useCallback, useEffect, useState } from 'react';

import { listSessions, type SessionSummary } from '@/lib/sessions';

/** Loads the saved-chat list and exposes a `refresh` to re-pull it (after a
 *  save or delete). Errors are swallowed in `listSessions`, so this never throws. */
export function useSessions() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);

  const refresh = useCallback(async () => {
    setSessions(await listSessions());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { sessions, refresh };
}
