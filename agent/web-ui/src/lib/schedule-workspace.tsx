import { createContext, useContext, useState, type ReactNode } from 'react';
import { useScheduledRuns } from './use-scheduled-runs';

export type ScheduleWorkspace = ReturnType<typeof useScheduledRuns> & {
  requestedChat?: { id: string };
  openChat: (id: string) => void;
};

const ScheduleWorkspaceContext = createContext<ScheduleWorkspace | undefined>(undefined);

export function ScheduleWorkspaceProvider({ enabled, children, onOpenChat }: {
  enabled: boolean; children: ReactNode; onOpenChat: () => void;
}) {
  return enabled ? <ConnectedScheduleWorkspace onOpenChat={onOpenChat}>{children}</ConnectedScheduleWorkspace> : children;
}

function ConnectedScheduleWorkspace({ children, onOpenChat }: { children: ReactNode; onOpenChat: () => void }) {
  const schedules = useScheduledRuns();
  const [requestedChat, setRequestedChat] = useState<{ id: string }>();

  const openChat = (id: string) => {
    setRequestedChat({ id });
    onOpenChat();
  };

  return <ScheduleWorkspaceContext.Provider value={{ ...schedules, requestedChat, openChat }}>
    {children}
  </ScheduleWorkspaceContext.Provider>;
}

export function useScheduleWorkspace() {
  return useContext(ScheduleWorkspaceContext);
}
