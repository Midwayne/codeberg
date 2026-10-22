import { isDeepStrictEqual } from 'node:util';
import type { WebSessionStore } from '../sessions/store.js';
import { RunError, type RunInput } from './types.js';

export async function validateHistory(sessions: WebSessionStore, input: RunInput) {
  const record = await sessions.load(input.chatId);
  if (!record?.serverRunId) return;

  const prefix = input.trigger === 'regenerate-message' && record.messages.at(-1)?.role === 'assistant'
    ? record.messages.slice(0, -1)
    : record.messages;
  if ((input.trigger === 'regenerate-message' ? input.messages.length !== prefix.length : input.messages.length <= prefix.length) || !isDeepStrictEqual(input.messages.slice(0, prefix.length), prefix)) {
    throw new RunError(409, 'Chat history changed in another tab. Reload this chat before sending a follow-up.');
  }
}
