import { useEffect, useState } from 'react';

import { loadContextStats, type ChatContextStats } from '../../lib/context-stats';
import { startPoll } from '../../lib/poll';
import { useProjectApi } from '../../lib/project-api';

/** Refresh often while a turn runs. */
const BUSY_INTERVAL_MS = 2_000;
const RETRY_INTERVAL_MS = 5_000;

/** The server saves the last request's numbers just after the turn ends, so load once more after this. */
const SETTLE_DELAY_MS = 1_500;

/** The chat's recorded context use, refreshed while the agent is working. */
export function useContextStats(sessionId: string, busy: boolean): ChatContextStats | undefined {
  const { fetch: api } = useProjectApi();
  const [stats, setStats] = useState<ChatContextStats>();

  useEffect(() => {
    let settling = !busy;

    const poll = startPoll({
      load: (signal) => loadContextStats(api, sessionId, signal),
      done: (value) => {
        setStats(value);

        if (busy) return BUSY_INTERVAL_MS;

        if (!settling) return undefined;

        settling = false;

        return SETTLE_DELAY_MS;
      },
      fail: () => (busy ? RETRY_INTERVAL_MS : undefined),
    });

    return () => poll.stop();
  }, [api, sessionId, busy]);

  return stats;
}
