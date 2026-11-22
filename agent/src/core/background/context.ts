import { AsyncLocalStorage } from 'node:async_hooks';
import type { BackgroundOwner, BackgroundService, RetainBackground } from './types.js';

export interface BackgroundContext extends BackgroundOwner {
  jobs: BackgroundService;
  retain?: RetainBackground;
  sleeping: boolean;
  signal?: AbortSignal;
  sleepWakeId?: string;
  sleepRequest?: Promise<unknown>;
  /** Subagent calls running in this turn's foreground; their reports arrive before the next step. */
  foregroundSubagents?: number;
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

const DETACHED_SUFFIX = ':background';

/** The call ID a detached (background) tool call runs under, distinct from any foreground call. */
export function detachedCallId(sourceRunId: string, toolCallId: string): string {
  return `${sourceRunId}:${toolCallId}${DETACHED_SUFFIX}`;
}

/**
 * Count a subagent call as foreground work in this turn until the returned
 * release runs. Detached calls are not counted: they outlive the turn.
 */
export function holdForeground(toolCallId: string): () => void {
  const context = backgroundContext.getStore();
  if (!context || toolCallId.endsWith(DETACHED_SUFFIX)) return () => undefined;

  context.foregroundSubagents = (context.foregroundSubagents ?? 0) + 1;
  let held = true;

  return () => {
    if (!held) return;

    held = false;
    context.foregroundSubagents = (context.foregroundSubagents ?? 1) - 1;
  };
}

export function runningInForeground(): boolean {
  return (backgroundContext.getStore()?.foregroundSubagents ?? 0) > 0;
}
