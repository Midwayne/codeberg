import { AsyncLocalStorage } from 'node:async_hooks';
import type { BackgroundOwner, BackgroundService, RetainBackground } from './types.js';

export interface BackgroundContext extends BackgroundOwner {
  jobs: BackgroundService;
  retain?: RetainBackground;
  sleeping: boolean;
  signal?: AbortSignal;
  sleepWakeId?: string;
  sleepRequest?: Promise<unknown>;
  /** Foreground subagent calls in the current step; their reports arrive before the next step. */
  subagentCallsThisStep?: number;
  /** Wake-ups this turn saved, then refused but could not cancel; the run cancels them when it ends. */
  withdrawWakeIds?: string[];
  /** A sleep withdrawn at the end of a step; the next step tells the model why it is still awake. */
  sleepWithdrawn?: boolean;
}

export const backgroundContext = new AsyncLocalStorage<BackgroundContext>();

/**
 * The subagent making a tool call, if any. Subagents share the main run, and
 * providers may reuse call ids (`call_0`), so background job ids include it.
 */
export const callerScope = new AsyncLocalStorage<string>();

/** A tool call id that is unique within the run, whichever agent made the call. */
export function runCallId(toolCallId: string): string {
  const caller = callerScope.getStore();

  return caller ? `${caller}:${toolCallId}` : toolCallId;
}

export function currentBackground(): BackgroundContext {
  const context = backgroundContext.getStore();
  if (!context) throw new Error('Background tools and agent sleep require a server-owned browser chat.');

  return context;
}

const DETACHED_SUFFIX = ':background';

/** The call ID a detached (background) tool call runs under, distinct from any foreground call. */
export function detachedCallId(sourceRunId: string, toolCallId: string): string {
  return `${sourceRunId}:${toolCallId}${DETACHED_SUFFIX}`;
}

/**
 * Note a foreground subagent call in this step of the turn. Its reports
 * arrive before the next step, so the turn must not sleep in this step,
 * even if the subagents already finished. Detached calls outlive the turn.
 */
export function noteForegroundSubagents(toolCallId: string): void {
  const context = backgroundContext.getStore();
  if (!context || toolCallId.endsWith(DETACHED_SUFFIX)) return;

  context.subagentCallsThisStep = (context.subagentCallsThisStep ?? 0) + 1;
}

/** Called before each model step of the main loop. */
export function beginAgentStep(): void {
  const context = backgroundContext.getStore();
  if (context) context.subagentCallsThisStep = 0;
}

export function subagentsThisStep(): boolean {
  return (backgroundContext.getStore()?.subagentCallsThisStep ?? 0) > 0;
}
