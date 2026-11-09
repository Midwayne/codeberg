import { AsyncLocalStorage } from 'node:async_hooks';
import { isValidSessionId } from '../api/sessions.js';
import { CanvasError } from './types.js';
import { withCanvasRecovery } from './recovery.js';

const context = new AsyncLocalStorage<{ chatId?: string }>();

export function validChatId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !isValidSessionId(value)) {
    throw new CanvasError('A valid chat ID is required for this canvas.');
  }
}

/** Resolve at tool execution: pooled agents can serve several concurrent chats. */
export function canvasChatId(fallback: string): string {
  const request = context.getStore();
  if (!request) return fallback;

  validChatId(request.chatId);
  return request.chatId;
}

export function withCanvasChat<T>(chatId: string | undefined, action: () => T): T {
  return context.run({ chatId }, () => withCanvasRecovery(action));
}
