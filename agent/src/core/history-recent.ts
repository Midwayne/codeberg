import type { ModelMessage } from 'ai';

import { messageTokens } from './history-tokens.js';

/** Recent history shares the window with its checkpoint and new evidence. */
export const RECENT_HISTORY_FRACTION = 0.25;
export const MAX_RECENT_HISTORY_TOKENS = 15_000;

/** A user message and all replies/tool exchanges after it are kept together. */
export function recentHistoryStart(
  messages: readonly ModelMessage[],
  budget: number,
  keepRecent?: number,
): number {
  if (keepRecent !== undefined) {
    const start = Math.max(0, messages.length - Math.max(1, Math.floor(keepRecent)));

    return exchangeStart(messages, start);
  }

  const allowance = Math.min(MAX_RECENT_HISTORY_TOKENS, Math.floor(budget * RECENT_HISTORY_FRACTION));
  let start = messages.length;
  let tokens = 0;

  while (start > 0) {
    const previous = exchangeStart(messages, start - 1);
    const size = messages.slice(previous, start).reduce((sum, message) => sum + messageTokens(message), 0);

    // Always retain the latest request, even if that exchange alone is large.
    if (start < messages.length && tokens + size > allowance) break;

    tokens += size;
    start = previous;
  }

  return start;
}

function exchangeStart(messages: readonly ModelMessage[], from: number): number {
  for (let index = from; index > 0; index--) {
    if (messages[index]?.role === 'user') return index;
  }

  return 0;
}
