import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The chat a run belongs to (its saved-session directory), set around every
 * browser chat run. Chat-owned state, such as kept browser sessions and
 * subagents, is keyed by it; terminal runs have none.
 */
export const chatScope = new AsyncLocalStorage<string>();
