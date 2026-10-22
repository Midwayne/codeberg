import type { UseChatHelpers } from '@ai-sdk/react';
import type { UIMessage } from 'ai';

import { useEffect, useLayoutEffect, useRef } from 'react';

import { MESSAGE_ID_ATTR } from '../../lib/message-rail';
import { useRetainedScroll } from './use-retained-scroll';
import { observeChatBottom } from './chat-bottom';

import type { useChatView } from './chat';

export type ChatScrollOptions = Pick<Parameters<typeof useChatView>[0], 'jump'> & {
  messages: UIMessage[];
  status: UseChatHelpers<UIMessage>['status'];
};

export function useChatScroll({ jump, messages }: ChatScrollOptions) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useRetainedScroll(scrollRef);
  const holdAutoScroll = useRef(false);
  const holdTimer = useRef(0);
  const handledJump = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    return observeChatBottom(element, holdAutoScroll);
  }, []);

  useEffect(() => {
    if (!jump || handledJump.current === jump.nonce) return;
    const target = scrollRef.current?.querySelector(`[${MESSAGE_ID_ATTR}="${CSS.escape(jump.messageId)}"]`);
    if (!(target instanceof HTMLElement)) return;
    handledJump.current = jump.nonce;
    holdAutoScroll.current = true;
    window.clearTimeout(holdTimer.current);
    target.scrollIntoView({ block: 'center', behavior: 'instant' });
    target.classList.remove('message-flash');
    void target.offsetWidth;
    target.classList.add('message-flash');
    holdTimer.current = window.setTimeout(() => {
      holdAutoScroll.current = false;
    }, 700);
  }, [jump, messages]);

  return { scrollRef, holdAutoScroll, holdTimer };
}
