import type { ChatInit, UIMessage } from 'ai';

import { deriveTitle } from '../lib/sessions';
import { ChatSaveState } from './chat-save-state';
import { interruptedMessages } from './interrupted-messages';
import type { WorkspaceChatSave } from './workspace-chat';

type PersistenceOptions = {
  serverOwned?: boolean;
  id: string;
  title?: string;
  parentId?: string;
  persist: (record: WorkspaceChatSave) => Promise<void>;
  onPersist?: () => void;
  disposed: () => boolean;
  setMessages: (messages: UIMessage[]) => void;
};

/** Serialize submission and completion writes so older snapshots cannot overwrite newer turns. */
export function chatPersistence(options: PersistenceOptions) {
  let saving = Promise.resolve();
  let latest: UIMessage[] = [];
  const state = new ChatSaveState(() => save(latest));

  const save = (messages: UIMessage[]) => {
    if (options.disposed() || !messages.length) return Promise.resolve();

    latest = messages;
    const record = {
      id: options.id,
      title: options.title ?? deriveTitle(messages),
      messages,
      ...(options.parentId ? { parentId: options.parentId } : {}),
    };
    saving = saving.catch(() => undefined).then(async () => {
      if (options.disposed()) return;

      try {
        await options.persist(record);
        state.saved();
        options.onPersist?.();
      } catch (error) {
        state.failed(error);
        throw error;
      }
    });

    return saving;
  };

  return { save, state, onFinish: finishPersistence(options, save), settled: () => saving.catch(() => undefined) };
}

function finishPersistence(
  options: PersistenceOptions,
  save: (messages: UIMessage[]) => Promise<void>,
): NonNullable<ChatInit<UIMessage>['onFinish']> {
  return ({ messages, isError, isAbort }) => {
    if (options.disposed()) return;

    const finished = !options.serverOwned && (isAbort || isError)
      ? interruptedMessages(messages, isError ? 'Response interrupted. Retry to continue.' : 'Stopped by user.')
      : messages;
    if (!options.serverOwned && (isAbort || isError)) options.setMessages(finished);

    void save(finished).catch(() => undefined);
  };
}
