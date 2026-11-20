import { chatScope } from '../chat-scope.js';
import { codebergDataHome } from '../paths.js';
import type { BrowserConfig } from './config.js';

/** Browser ownership follows the chat, independently of cached model agents. */
export const browserConversation = chatScope;

export function browserOwner(config: BrowserConfig): string {
  return browserConversation.getStore() ?? config.owner ?? codebergDataHome(config.env);
}
