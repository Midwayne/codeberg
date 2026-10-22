import { Chat } from '@ai-sdk/react';
import { type ChatTransport, type UIMessage } from 'ai';

import { RunTransport } from './run-transport';
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
  serverOwned?: boolean;
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
  serverOwned = transport === undefined,
}: CreateWorkspaceChatOptions): WorkspaceChat {
  let disposed = false;
  const runTransport = transport instanceof RunTransport ? transport : transport ? undefined : new RunTransport();
  const persistence = chatPersistence({
    serverOwned,
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
  const savedTransport = persistingTransport(transport ?? runTransport!, persistence.save);
  const chat = new Chat<UIMessage>({
    id,
    messages,
    transport: savedTransport,
    onFinish: persistence.onFinish,
  });
  const turns = createTurnQueue(chat, savedTransport.isPending, runTransport);

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

function createTurnQueue(chat: Chat<UIMessage>, isPending: () => boolean, transport?: RunTransport) {
  transport?.bindMessages(() => chat.messages);

  return new TurnQueue(chat, transport ? {
    stop: async () => {
      if (isPending() && !transport.isReplaying) {
        await chat.stop();
        return false;
      }
      await transport.stop(chat.id);
      return true;
    },
    retry: () => transport.retry(chat),
    synchronize: () => transport.synchronize(chat),
  } : undefined);
}
