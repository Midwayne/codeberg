import { AsyncLocalStorage } from 'node:async_hooks';
import type { BackgroundOwner, BackgroundService, RetainBackground } from './types.js';

export interface BackgroundContext extends BackgroundOwner {
  jobs: BackgroundService;
  retain?: RetainBackground;
  sleeping: boolean;
  signal?: AbortSignal;
  sleepWakeId?: string;
  sleepRequest?: Promise<unknown>;
}

export const backgroundContext = new AsyncLocalStorage<BackgroundContext>();

export function currentBackground(): BackgroundContext {
  const context = backgroundContext.getStore();
  if (!context) throw new Error('Background tools and agent sleep require a server-owned browser chat.');

  return context;
}

/** Evaluated after each tool step, without aborting the work the agent started. */
export function agentIsSleeping(): boolean {
  return backgroundContext.getStore()?.sleeping === true;
}
