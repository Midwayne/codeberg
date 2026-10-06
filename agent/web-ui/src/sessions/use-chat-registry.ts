import { DefaultChatTransport } from 'ai';

import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { useCallback, useEffect, useState } from 'react';

import { newSessionId, saveSession } from '../lib/sessions';
import { createWorkspaceChat, type WorkspaceChat } from './workspace-chat';

export type ChatRegistryOptions = {
  api: typeof fetch;
  refreshRef: React.RefObject<() => Promise<void>>;
  chats: React.RefObject<Map<string, WorkspaceChat>>;
  seededRailPreview: React.RefObject<boolean>;
};

export function useChatRegistry({ api, refreshRef, chats, seededRailPreview }: ChatRegistryOptions) {
  const createChat = useCallback(
    (id: string, messages: UIMessage[], parentId?: string, title?: string) => {
      const next = createWorkspaceChat({
        id,
        messages,
        parentId,
        title,
        persist: (record) => saveSession(record, api),
        transport: new DefaultChatTransport({ api: '/api/chat', fetch: api }),
        onPersist: () => void refreshRef.current(),
      });
      chats.current.set(id, next);
      return next;
    },
    [api],
  );
  const [active, setActive] = useState(() => createChat(newSessionId(), []));
  const chat = useChat({ chat: active.chat });
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

  return { setActive, createChat, sessionId, chat, active };
}
