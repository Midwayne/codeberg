import type { UseChatHelpers } from '@ai-sdk/react';
import type { UIMessage } from 'ai';

import { useEffect, useRef } from 'react';

import { MESSAGE_ID_ATTR } from '../../lib/message-rail';

import { type useChatView } from './chat';

export type ChatScrollOptions = Pick<Parameters<typeof useChatView>[0], 'jump'> & {
  messages: UIMessage[];
  status: UseChatHelpers<UIMessage>['status'];
};

export function useChatScroll({ jump, messages, status }: ChatScrollOptions) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const holdAutoScroll = useRef(false);
  const holdTimer = useRef(0);
  const handledJump = useRef<number | undefined>(undefined);
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
  // Keep the view pinned to the latest content unless the user has scrolled up
  // or just jumped via the tick rail (smooth scroll would still look "near
  // bottom" for a frame and the pin would yank them back).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || holdAutoScroll.current) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, status]);

  return { scrollRef, bottomRef, holdAutoScroll, holdTimer };
}
