import type { UseChatHelpers } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { useSyncExternalStore } from 'react';

import { EMPTY_QUEUE, type TurnQueue } from '../../sessions/turn-queue';

const emptySubscribe = () => () => {};
const emptySnapshot = () => EMPTY_QUEUE;

export function useTurnQueue(turns: TurnQueue | undefined, chat: UseChatHelpers<UIMessage>) {
  const snapshot = useSyncExternalStore(turns?.subscribe ?? emptySubscribe,
    turns?.getSnapshot ?? emptySnapshot, turns?.getSnapshot ?? emptySnapshot);

  const send = (text: string, files: FileList) => {
    const input = { text, ...(files.length ? { files } : {}) };
    if (turns) turns.submit(input);
    else void chat.sendMessage(input);
  };
  const steer = turns && !snapshot.steering ? (text: string, files: FileList) => {
    void turns.steer({ text, ...(files.length ? { files } : {}) });
  } : undefined;

  return { snapshot, send, steer,
    stop: turns?.stop ?? chat.stop,
    retry: turns?.retry ?? chat.regenerate,
    remove: turns?.remove,
    resume: turns?.resume,
    steerQueued: turns?.steerQueued,
  };
}
