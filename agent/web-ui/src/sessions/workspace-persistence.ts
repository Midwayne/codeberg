import type { ChatInit, UIMessage } from 'ai';

import { deriveTitle } from '../lib/sessions';
import { interruptedMessages } from './interrupted-messages';
import type { WorkspaceChatSave } from './workspace-chat';

type PersistenceOptions = {
  id: string;
  messages: UIMessage[];
  title?: string;
  parentId?: string;
  persist: (record: WorkspaceChatSave) => Promise<void>;
  onPersist?: () => void;
  disposed: () => boolean;
  setMessages: (messages: UIMessage[]) => void;
};

function signature(messages: readonly UIMessage[]): string {
  return `${messages.length}:${messages.at(-1)?.id ?? ''}`;
}

export function chatPersistence(options: PersistenceOptions): NonNullable<ChatInit<UIMessage>['onFinish']> {
  let savedSignature = signature(options.messages);
  let saving = Promise.resolve();

  return ({ messages, isError, isAbort }) => {
    if (options.disposed() || isError || !messages.length) return;

    const finished = isAbort ? interruptedMessages(messages) : messages;
    if (isAbort) options.setMessages(finished);

    const nextSignature = signature(finished);
    if (nextSignature === savedSignature) return;
    savedSignature = nextSignature;

    const record = { id: options.id, title: options.title ?? deriveTitle(finished), messages: finished,
      ...(options.parentId ? { parentId: options.parentId } : {}) };
    saving = saving.catch(() => undefined).then(async () => {
      if (options.disposed()) return;

      await options.persist(record);
      options.onPersist?.();
    });
    void saving.catch(() => undefined);
  };
}
