import { Chat } from '@ai-sdk/react';
import { DefaultChatTransport, type ChatTransport, type UIMessage } from 'ai';

import { TurnQueue } from './turn-queue';
import { chatPersistence } from './workspace-persistence';
import { persistingTransport } from './persisting-transport';
import type { ChatSaveState } from './chat-save-state';

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
  persistence: ChatSaveState;
  /** Unsent text belongs to this tab's session, independently of retained DOM. */
  draft: { text: string };
  readonly disposed: boolean;
  readonly createdAt: number;
  dispose: () => Promise<void>;
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
  const persistence = chatPersistence({
    id,
    title,
    parentId,
    persist,
    onPersist,
    disposed: () => disposed,
    setMessages: (next) => {
      chat.messages = next;
    },
  });
  const chat = new Chat<UIMessage>({
    id,
    messages,
    transport: persistingTransport(transport ?? new DefaultChatTransport(), persistence.save),
    onFinish: persistence.onFinish,
  });
  const turns = new TurnQueue(chat);

  return {
    id,
    title,
    parentId,
    chat,
    turns,
    persistence: persistence.state,
    draft: { text: '' },
    createdAt: Date.now(),
    get disposed() { return disposed; },
    dispose: async () => {
      disposed = true;
      turns.dispose();
      await persistence.settled();
    },
  };
}
