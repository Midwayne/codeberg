import { WorkspaceSidebar, WorkspaceSearch } from './workspace-controls';

import { Chat } from '../chat/chat';

import { useWorkspaceSession } from '../../sessions/use-workspace-session';
import { useState, type ReactNode } from 'react';

import { type CatalogModel } from '../../lib/models';
import { Dialog } from '../ui';

import { useMediaQuery } from '../../lib/use-media-query';

/**
 * Composes the chat and sidebar around the shared session lifecycle.
 */
export type WorkspaceProps = {
  projectControls?: ReactNode;
  sidebarOpen: boolean;
  onSidebarClose: () => void;
  learningEnabled: boolean;
  chatInputs: CatalogModel['inputs'];
  searchOpen: boolean;
  onSearchClose: () => void;
};

export function Workspace(props: WorkspaceProps) {
  const state = useWorkspaceView(props);

  return <WorkspaceView {...state} />;
}

export function useWorkspaceView({
  projectControls,
  sidebarOpen,
  onSidebarClose,
  learningEnabled,
  chatInputs,
  searchOpen,
  onSearchClose,
}: WorkspaceProps) {
  const { chat, turns, sessions, sessionId, sessionError, resume, startNew, branchFrom, remove, setFlags } =
    useWorkspaceSession();
  const [jump, setJump] = useState<{ sessionId: string; messageId: string; nonce: number }>();
  const desktop = useMediaQuery('(min-width: 768px)');
  const sidebar = (
    <WorkspaceSidebar
      projectControls={projectControls}
      desktop={desktop}
      onSidebarClose={onSidebarClose}
      sessions={sessions}
      sessionError={sessionError}
      sessionId={sessionId}
      chat={chat}
      resume={resume}
      startNew={startNew}
      branchFrom={branchFrom}
      remove={remove}
      setFlags={setFlags}
    />
  );
  return {
    desktop,
    sidebarOpen,
    sidebar,
    onSidebarClose,
    chat,
    turns,
    sessionId,
    learningEnabled,
    chatInputs,
    branchFrom,
    jump,
    searchOpen,
    onSearchClose,
    sessions,
    setJump,
    resume,
  };
}

export type WorkspaceViewProps = ReturnType<typeof useWorkspaceView>;

export function WorkspaceView(state: WorkspaceViewProps) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {state.desktop && state.sidebarOpen && state.sidebar}
      {!state.desktop && (
        <Dialog
          motion="drawer"
          open={state.sidebarOpen}
          label="Projects and chats"
          onClose={state.onSidebarClose}
          className="m-0 h-dvh max-h-none w-[min(20rem,calc(100vw-3rem))] max-w-none rounded-none border-r border-border bg-card shadow-none"
        >
          {state.sidebar}
        </Dialog>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Chat
          chat={state.chat}
          turns={state.turns}
          sessionId={state.sessionId}
          learningEnabled={state.learningEnabled}
          chatInputs={state.chatInputs}
          onBranch={(index) => void state.branchFrom(index)}
          jump={state.jump?.sessionId === state.sessionId ? state.jump : undefined}
        />
      </div>
      <WorkspaceSearch
        searchOpen={state.searchOpen}
        onSearchClose={state.onSearchClose}
        sessionId={state.sessionId}
        sessions={state.sessions}
        chat={state.chat}
        setJump={state.setJump}
        resume={state.resume}
      />
    </div>
  );
}
