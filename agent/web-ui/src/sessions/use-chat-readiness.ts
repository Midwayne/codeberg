import type { Chat } from '@ai-sdk/react';
import type { ChatStatus, UIMessage } from 'ai';
import { useCallback, useSyncExternalStore } from 'react';

export type ChatReadiness = { status: ChatStatus; hasMessages: boolean };

/**
 * What the workspace chrome needs from the active chat. Unlike `useChat`, it
 * re-renders on status changes and the first message, not on every streamed token.
 */
export function useChatReadiness(chat: Chat<UIMessage>): ChatReadiness {
  const onStatus = useCallback((update: () => void) => chat['~registerStatusCallback'](update), [chat]);
  const onMessages = useCallback((update: () => void) => chat['~registerMessagesCallback'](update), [chat]);

  const status = useSyncExternalStore(onStatus, () => chat.status);
  const hasMessages = useSyncExternalStore(onMessages, () => chat.messages.length > 0);

  return { status, hasMessages };
}

/** The chat's messages, followed live only while `active` (e.g. a search dialog is open). */
export function useChatMessagesWhile(chat: Chat<UIMessage>, active: boolean): UIMessage[] {
  const subscribe = useCallback(
    (update: () => void) => (active ? chat['~registerMessagesCallback'](update) : () => undefined),
    [chat, active],
  );

  return useSyncExternalStore(subscribe, () => chat.messages);
}
