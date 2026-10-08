import { Chat } from '@ai-sdk/react';
import type { ChatTransport, UIMessage } from 'ai';

import { TurnQueue } from './turn-queue';
import { chatPersistence } from './workspace-persistence';

export interface WorkspaceChatSave {
  id: string;
  title: string;
  messages: UIMessage[];
  parentId?: string;
}

export interface WorkspaceChat {
  id: string;
  title?: string;
  parentId?: string;
  chat: Chat<UIMessage>;
  turns: TurnQueue;
  dispose: () => void;
}

interface CreateWorkspaceChatOptions {
  id: string;
  messages: UIMessage[];
  title?: string;
  parentId?: string;
  transport?: ChatTransport<UIMessage>;
  persist: (record: WorkspaceChatSave) => Promise<void>;
  onPersist?: () => void;
}

/** Creates one independently streaming chat whose completion persists to its owning session. */
export function createWorkspaceChat({
  id,
  messages,
  title,
  parentId,
  transport,
  persist,
  onPersist,
}: CreateWorkspaceChatOptions): WorkspaceChat {
  let disposed = false;
  const chat = new Chat<UIMessage>({
    id,
    messages,
    ...(transport ? { transport } : {}),
    onFinish: chatPersistence({ id, messages, title, parentId, persist, onPersist,
      disposed: () => disposed, setMessages: (next) => { chat.messages = next; } }),
  });
  const turns = new TurnQueue(chat);

  return {
    id,
    title,
    parentId,
    chat,
    turns,
    dispose: () => {
      disposed = true;
      turns.dispose();
    },
  };
}
