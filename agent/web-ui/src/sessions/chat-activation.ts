import { startTransition } from 'react';

import type { WorkspaceChat } from './workspace-chat';
import type { ChatTransitionsOptions } from './use-chat-transitions';

type ActivationOptions = Pick<ChatTransitionsOptions, 'transitionIntent' | 'setActive' | 'setLoad'>;
type SelectionOptions = Pick<ChatTransitionsOptions, 'chats' | 'sessionId' | 'setActive'>;

/** An urgent selection supersedes older transitions that have not committed. */
export function restoreChatSelection({ chats, sessionId, setActive }: SelectionOptions) {
  const previous = chats.current.get(sessionId);
  if (previous && !previous.disposed) setActive(previous);
}

/** Let feedback paint before mounting a transcript that has no retained view. */
export async function activateChat(next: WorkspaceChat, intent: number, options: ActivationOptions) {
  const { transitionIntent, setActive, setLoad } = options;
  setLoad({ id: next.id, status: 'loading' });

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  if (intent !== transitionIntent.current) return;
  if (next.disposed) {
    setLoad(undefined);

    return;
  }

  startTransition(() => {
    setActive(next);
    setLoad(undefined);
  });
}
