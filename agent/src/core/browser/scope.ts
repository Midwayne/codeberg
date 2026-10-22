import { AsyncLocalStorage } from 'node:async_hooks';
import { codebergDataHome } from '../paths.js';
import type { BrowserConfig } from './config.js';

/** Browser ownership follows the chat, independently of cached model agents. */
export const browserConversation = new AsyncLocalStorage<string>();

export function browserOwner(config: BrowserConfig): string {
  return browserConversation.getStore() ?? config.owner ?? codebergDataHome(config.env);
}
