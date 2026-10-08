import { useSessionMutations } from './use-session-mutations';
import { useChatTransitions, useChatBranch } from './use-chat-transitions';
import { useChatRegistry } from './use-chat-registry';

import { useProjectApi } from '../lib/project-api';

import { useRef, useState } from 'react';

import { useSessions } from '../lib/use-sessions';

import { type WorkspaceChat } from './workspace-chat';

/** Owns the conversation lifecycle shared by the chat and session sidebar. */
export function useWorkspaceSession() {
  const { fetch: api } = useProjectApi();
  const [sessionError, setSessionError] = useState('');
  const { sessions, refresh } = useSessions();
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const chats = useRef(new Map<string, WorkspaceChat>());
  const transitionIntent = useRef(0);
  const seededRailPreview = useRef(false);
  const { setActive, createChat, sessionId, chat, active } = useChatRegistry({
    api,
    refreshRef,
    chats,
    seededRailPreview,
  });
  const { startNew, resume } = useChatTransitions({
    transitionIntent,
    chats,
    setActive,
    api,
    refresh,
    createChat,
    sessionId,
  });

  const { branchFrom } = useChatBranch({ chat, transitionIntent, active, api, refresh, setActive, createChat });
  const { remove, setFlags } = useSessionMutations({
    transitionIntent,
    chats,
    sessionId,
    startNew,
    api,
    refresh,
    setSessionError,
  });

  return { chat, turns: active.turns, sessions, sessionId, sessionError, resume, startNew, branchFrom, remove, setFlags };
}
