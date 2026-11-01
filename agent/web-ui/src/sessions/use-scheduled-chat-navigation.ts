import { useEffect, useLayoutEffect, useRef } from 'react';
import { useScheduleWorkspace } from '../lib/schedule-workspace';

/** Use the normal resume lifecycle so failures, active turns and drafts stay local. */
export function useScheduledChatNavigation(resume: (id: string, options?: { reload: boolean }) => Promise<void>) {
  const requested = useScheduleWorkspace()?.requestedChat;
  const committed = useRef(resume);

  useLayoutEffect(() => {
    committed.current = resume;
  }, [resume]);

  useEffect(() => {
    if (requested) void committed.current(requested.id, { reload: true });
  }, [requested]);
}
