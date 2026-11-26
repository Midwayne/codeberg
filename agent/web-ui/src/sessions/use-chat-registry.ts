import { RunTransport } from './run-transport';

import { useCallback, useEffect, useState } from 'react';

import { newSessionId, saveSession, setSessionModel } from '../lib/sessions';
import { createWorkspaceChat, type CreateChat, type WorkspaceChat } from './workspace-chat';
import type { ProjectChats } from './project-chat-registry';
import { useChatReadiness } from './use-chat-readiness';

type ChatRegistryOptions = {
  api: typeof fetch;
  registry: ProjectChats;
  refreshRef: React.RefObject<() => Promise<void>>;
  chats: React.RefObject<Map<string, WorkspaceChat>>;
  seededRailPreview: React.RefObject<boolean>;
};

/** Opens chats that save to this project's sessions and run on the server. */
function useCreateChat(api: typeof fetch, registry: ProjectChats, chats: React.RefObject<Map<string, WorkspaceChat>>): CreateChat {
  return useCallback(
    (id, messages, parentId, title, origin) => {
      const next = createWorkspaceChat({
        id,
        messages,
        parentId,
        title,
        origin,
        persist: (record) => saveSession(record, api),
        persistModel: (choice) => setSessionModel(id, choice, api),
        transport: new RunTransport(api),
        serverOwned: true,
        onPersist: registry.persisted,
      });
      chats.current.set(id, next);

      return next;
    },
    [api, registry, chats],
  );
}

export function useChatRegistry({ api, registry, refreshRef, chats, seededRailPreview }: ChatRegistryOptions) {
  const createChat = useCreateChat(api, registry, chats);

  const [active, updateActive] = useState(() => {
    const initial = registry.active ?? createChat(newSessionId(), []);
    registry.active = initial;

    return initial;
  });
  const setActive: React.Dispatch<React.SetStateAction<WorkspaceChat>> = useCallback((next) => {
    const selected = typeof next === 'function' ? next(registry.active!) : next;
    registry.active = selected;
    updateActive(selected);
  }, [registry]);

  useEffect(() => registry.subscribe(() => void refreshRef.current()), [registry, refreshRef]);
  // Status only: subscribing to messages here would re-render the whole workspace per token.
  const readiness = useChatReadiness(active.chat);
  const sessionId = active.id;

  // Dev-only: `?preview=rail` fills a tall transcript so the tick rail can be
  // exercised without a running model. Tree-shaken out of production builds.
  useEffect(() => {
    if (seededRailPreview.current) return;
    if (!import.meta.env.DEV) return;
    if (new URLSearchParams(window.location.search).get('preview') !== 'rail') return;
    seededRailPreview.current = true;
    void import('@/lib/rail-preview').then(({ RAIL_PREVIEW_MESSAGES }) => {
      active.chat.messages = RAIL_PREVIEW_MESSAGES;
    });
  }, [active]);

  return { setActive, createChat, sessionId, readiness, active };
}
