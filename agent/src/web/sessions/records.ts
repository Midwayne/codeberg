import type { UIMessage } from 'ai';

export { isValidSessionId } from '../../core/api/sessions.js';

export function countTurns(messages: UIMessage[]): number {
  return messages.filter((m) => m.role === 'user').length;
}
