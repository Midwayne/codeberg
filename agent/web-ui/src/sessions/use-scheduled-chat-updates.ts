import { useEffect, useMemo, useState } from 'react';
import { useScheduleWorkspace } from '../lib/schedule-workspace';
import { ScheduledChatUpdates } from './scheduled-chat-updates';
import type { WorkspaceChat } from './workspace-chat';

export function useScheduledChatUpdates(chats: Map<string, WorkspaceChat>, api: typeof fetch) {
  const jobs = useScheduleWorkspace()?.jobs;
  const updates = useMemo(() => new ScheduledChatUpdates(chats, api), [chats, api]);
  const [error, setError] = useState('');

  useEffect(() => {
    updates.activate();

    return () => updates.close();
  }, [updates]);

  useEffect(() => {
    let current = true;
    void updates.refresh(jobs ?? []).then(() => {
      if (current) setError('');
    }, () => {
      if (current) setError('Could not update scheduled chat responses. Retrying automatically.');
    });

    return () => {
      current = false;
    };
  }, [jobs, updates]);

  return error;
}
