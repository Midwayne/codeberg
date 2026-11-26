import type { UseChatHelpers } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { useSyncExternalStore } from 'react';

import { DIAGRAM_REQUEST } from '@agent/core/canvas/request.js';

import { EMPTY_QUEUE, type TurnQueue } from '../../sessions/turn-queue';
import type { PromptSendOptions } from './use-prompt-input';

const emptySubscribe = () => () => {};
const emptySnapshot = () => EMPTY_QUEUE;

export function useTurnQueue(turns: TurnQueue | undefined, chat: UseChatHelpers<UIMessage>) {
  const snapshot = useSyncExternalStore(turns?.subscribe ?? emptySubscribe,
    turns?.getSnapshot ?? emptySnapshot, turns?.getSnapshot ?? emptySnapshot);

  const send = (text: string, files: FileList, options?: PromptSendOptions) => {
    const input = turnInput(text, files, options);
    if (turns) turns.submit(input);
    else void chat.sendMessage(input);
  };
  const steer = turns && !snapshot.steering ? (text: string, files: FileList, options?: PromptSendOptions) => {
    void turns.steer(turnInput(text, files, options));
  } : undefined;

  return { snapshot, send, steer,
    stop: turns?.stop ?? chat.stop,
    retry: turns?.retry ?? chat.regenerate,
    regenerate: turns?.regenerate ?? chat.regenerate,
    remove: turns?.remove,
    resume: turns?.resume,
    steerQueued: turns?.steerQueued,
  };
}

/** A user turn; a diagram request travels as message metadata so retries keep it. */
function turnInput(text: string, files: FileList, options?: PromptSendOptions) {
  return {
    text,
    ...(files.length ? { files } : {}),
    ...(options?.diagram ? { metadata: DIAGRAM_REQUEST } : {}),
  };
}
