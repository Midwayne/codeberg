import type { ModelMessage } from 'ai';

import { messageTranscript } from './message.js';

/** Rough, provider-independent estimate used to decide when to compact. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function messageTokens(message: ModelMessage): number {
  // Tool calls and results dominate long sessions; text-only counting misses them.
  return estimateTokens(messageTranscript(message));
}

export function totalTokens(messages: readonly ModelMessage[]): number {
  return messages.reduce((sum, message) => sum + messageTokens(message), 0);
}
