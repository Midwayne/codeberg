import type { ScheduleSummary } from '@agent/core/schedules/summary';
import { useEffect } from 'react';

import { useScheduleWorkspace } from '../lib/schedule-workspace';
import { markSessionRead, type SessionSummary } from '../lib/sessions';

type MarkReadOptions = {
  sessions: SessionSummary[];
  currentId: string;
  api: typeof fetch;
  refresh: () => Promise<void>;
};

/** Keeps sidebar unread marks current: refresh after scheduled runs, clear the open chat. */
export function useUnreadChats(options: MarkReadOptions) {
  useMarkOpenChatRead(options);
  useRefreshOnScheduledRuns(options.refresh);
}

/**
 * The open chat counts as read while the tab is visible. A reply that finishes
 * while the tab is hidden stays unread on the server until the user returns.
 */
export function useMarkOpenChatRead({ sessions, currentId, api, refresh }: MarkReadOptions) {
  const unread = sessions.some((session) => session.id === currentId && session.unread);

  useEffect(() => {
    if (!unread) return;

    const mark = () => {
      if (document.visibilityState !== 'visible') return;

      void markSessionRead(currentId, api).then(refresh, () => undefined);
    };

    mark();
    document.addEventListener('visibilitychange', mark);

    return () => document.removeEventListener('visibilitychange', mark);
  }, [unread, currentId, api, refresh]);
}

/**
 * A scheduled run can finish in a chat that is not open in this tab, so no
 * local save refreshes the sidebar. Re-list chats when a run's status changes.
 */
export function useRefreshOnScheduledRuns(refresh: () => Promise<void>) {
  const jobs = useScheduleWorkspace()?.jobs;
  const version = scheduledRunVersion(jobs ?? []);

  useEffect(() => {
    if (version) void refresh();
  }, [version, refresh]);
}

export function scheduledRunVersion(jobs: readonly ScheduleSummary[]): string {
  return jobs
    .filter((job) => job.kind !== 'background')
    .map((job) => `${job.chatId}:${job.lastRunId ?? ''}:${job.activeRun?.id ?? ''}:${job.status}`)
    .sort()
    .join('|');
}
