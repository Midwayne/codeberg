import { useSessionMutations } from './use-session-mutations';
import { useChatTransitions, useChatBranch } from './use-chat-transitions';
import { useChatRegistry } from './use-chat-registry';

import { useProjectApi } from '../lib/project-api';

import { useRef, useState } from 'react';

import { useSessions } from '../lib/use-sessions';

import { useProjectChats } from './project-chats';
import { workspaceSummaries } from './workspace-summaries';
import type { ChatLoad } from './chat-resume';
import type { WorkspaceChat } from './workspace-chat';

/** Owns the conversation lifecycle shared by the chat and session sidebar. */
export function useWorkspaceSession() {
  const { fetch: api } = useProjectApi();
  const [sessionError, setSessionError] = useState('');
  const [load, setLoad] = useState<ChatLoad>();
  const { sessions: savedSessions, refresh } = useSessions();
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const registry = useProjectChats();
  const chats = useRef(registry.chats);
  const transitionIntent = useRef(0);
  const renderedViews = useRef<ReadonlySet<WorkspaceChat>>(new Set());
  const seededRailPreview = useRef(false);
  const { setActive, createChat, sessionId, chat, active } = useChatRegistry({
    api,
    registry,
    refreshRef,
    chats,
    seededRailPreview,
  });
  const { startNew, resume, cancelResume } = useChatTransitions({
    transitionIntent,
    renderedViews,
    chats,
    setActive,
    setLoad,
    api,
    refresh,
    createChat,
    sessionId,
  });

  const { branchFrom } = useChatBranch({ chat, transitionIntent, active, api, refresh, setActive, createChat, setSessionError });
  const { remove, setFlags } = useSessionMutations({
    cancelResume,
    chats,
    sessionId,
    startNew,
    api,
    refresh,
    setSessionError,
  });

  const sessions = workspaceSummaries(savedSessions, registry.chats);

  return { active, chat, renderedViews, sessions, sessionId, sessionError, load, cancelResume, resume, startNew, branchFrom, remove, setFlags };
}
