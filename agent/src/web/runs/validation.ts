import { isDeepStrictEqual } from 'node:util';
import type { UIMessage } from 'ai';
import type { WebSessionStore } from '../sessions/store.js';
import { RunError, type RunInput } from './types.js';

export async function validateHistory(sessions: WebSessionStore, input: RunInput) {
  const record = await sessions.load(input.chatId);
  if (!record?.serverRunId) return;

  const prefix = input.trigger === 'regenerate-message' && record.messages.at(-1)?.role === 'assistant'
    ? record.messages.slice(0, -1)
    : record.messages;
  const validLength = input.trigger === 'regenerate-message'
    ? input.messages.length === prefix.length
    : input.messages.length > prefix.length;
  if (!validLength || !prefix.every((message, index) => matchesHistory(message, input.messages[index]))) {
    throw new RunError(409, 'Chat history changed in another tab. Reload this chat before sending a follow-up.');
  }

  // Browser SDKs can reconstruct the same answer differently (e.g. reasoning ids).
  // Always continue from the server's answers, including tool results and metadata.
  input.messages = [...prefix, ...input.messages.slice(prefix.length)];
}

function matchesHistory(saved: UIMessage, submitted: UIMessage | undefined): boolean {
  if (!submitted || saved.id !== submitted.id || saved.role !== submitted.role) return false;

  return saved.role === 'assistant' || isDeepStrictEqual(saved, submitted);
}
