import { useCallback, useEffect, useRef, useState } from 'react';

import { listSessions, type SessionSummary } from '@/lib/sessions';

/** Loads the saved-chat list and exposes a `refresh` to re-pull it (after a
 *  save or delete). Errors are swallowed in `listSessions`, so this never throws. */
export function useSessions() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const request = useRef(0);

  const refresh = useCallback(async () => {
    const current = ++request.current;
    const result = await listSessions();
    if (current === request.current) setSessions(result);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    return () => { clearTimeout(timer); ++request.current; };
  }, [refresh]);

  return { sessions, refresh };
}
