import { Chat } from '@ai-sdk/react';
import type { ChatTransport, UIMessage } from 'ai';

import { deriveTitle } from '@/lib/sessions';

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

function signature(messages: readonly UIMessage[]): string {
  return `${messages.length}:${messages.at(-1)?.id ?? ''}`;
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
  let savedSignature = signature(messages);
  const chat = new Chat<UIMessage>({
    id,
    messages,
    ...(transport ? { transport } : {}),
    onFinish: ({ messages: finishedMessages, isError }) => {
      if (disposed || isError || finishedMessages.length === 0) return;
      const nextSignature = signature(finishedMessages);
      if (nextSignature === savedSignature) return;
      savedSignature = nextSignature;
      void persist({
        id,
        title: title ?? deriveTitle(finishedMessages),
        messages: finishedMessages,
        ...(parentId ? { parentId } : {}),
      })
        .then(onPersist)
        .catch(() => undefined);
    },
  });

  return {
    id,
    title,
    parentId,
    chat,
    dispose: () => {
      disposed = true;
      void chat.stop();
    },
  };
}
