import type { ModelMessage } from 'ai';

import { scheduleContext } from '../schedules/context.js';
import { SUBAGENT_TOOL_NAMES } from '../subagents/names.js';
import { backgroundContext, currentBackground, subagentsThisStep, type BackgroundContext } from './context.js';

export interface SleepInput {
  delay_seconds?: number;
  run_at?: string;
  prompt: string;
  job_ids?: string[];
}

export async function sleepAgent(input: SleepInput): Promise<unknown> {
  const context = currentBackground();
  const scheduling = scheduleContext.getStore();
  if (!scheduling) throw new Error('Agent sleep requires a server-owned chat scheduler.');
  if (context.sleepRequest) throw new Error('This turn already requested a wake-up.');
  if (input.job_ids !== undefined && (!Array.isArray(input.job_ids) || input.job_ids.length > 8 || input.job_ids.some((id) => typeof id !== 'string'))) {
    throw new Error('Supply up to 8 job IDs from this chat.');
  }

  const save = async () => {
    context.signal?.throwIfAborted();
    await Promise.all((input.job_ids ?? []).map((id) => context.jobs.get(context.chatId, id)));
    const wake = await scheduling.scheduler.create(scheduling, { prompt: input.prompt,
      delay_seconds: input.delay_seconds, run_at: input.run_at, background_job_ids: input.job_ids });
    const wakeId = wake && typeof wake === 'object' && 'id' in wake && typeof wake.id === 'string' ? wake.id : undefined;

    // Checked after saving, once every call in this step has started.
    if (subagentsThisStep()) await refuseForeground(context, scheduling.scheduler, wakeId);

    if (wakeId) context.sleepWakeId = wakeId;
    context.sleeping = true;

    return { sleeping: true, wake };
  };
  context.sleepRequest = save();
  try {
    return await context.sleepRequest;
  } catch (error) {
    context.sleepRequest = undefined;
    throw error;
  }
}

const FOREGROUND_SUBAGENTS = 'run_subagents ran in the foreground of this step, and its reports arrive ' +
  'before your next step. Read them first, or start run_subagents with start_background_tool and sleep with its job ID.';

type Scheduler = { cancel(chatId: string, id: string): Promise<unknown> };

/**
 * Withdraw the wake-up just saved so the turn continues to the subagent
 * reports. If cancelling fails, the run retries when the turn ends.
 */
async function refuseForeground(context: BackgroundContext, scheduler: Scheduler, wakeId: string | undefined): Promise<never> {
  if (wakeId) {
    await scheduler.cancel(context.chatId, wakeId).catch(() => {
      context.withdrawWakeIds = [...(context.withdrawWakeIds ?? []), wakeId];
    });
  }

  throw new Error(FOREGROUND_SUBAGENTS);
}

const WITHDRAWN_NOTE = 'Your sleep_agent was withdrawn: run_subagents ran in the same step, and its reports are above. ' +
  'Read them first; call sleep_agent again only if work is still running.';

type StepCalls = { steps: Array<{ toolCalls: ReadonlyArray<{ toolName: string }> }> };

/**
 * The main loop's stop condition for sleep. A step that saved a sleep and
 * also called run_subagents in the foreground has fresh reports nobody read,
 * so the wake-up is withdrawn and the turn continues, whatever order the
 * calls ran in.
 */
export async function sleepEndsTurn({ steps }: StepCalls): Promise<boolean> {
  const context = backgroundContext.getStore();
  if (context?.sleeping !== true) return false;

  const ranSubagents = steps.at(-1)?.toolCalls.some((call) => SUBAGENT_TOOL_NAMES.includes(call.toolName));
  if (!ranSubagents) return true;

  const wakeId = context.sleepWakeId;
  context.sleeping = false;
  context.sleepRequest = undefined;
  context.sleepWakeId = undefined;
  context.sleepWithdrawn = true;

  const scheduler = scheduleContext.getStore()?.scheduler;
  if (wakeId && scheduler) await refuseQuietly(context, scheduler, wakeId);

  return false;
}

/** Append the withdrawal note once, on the step after a sleep was withdrawn. */
export function withSleepNote(messages: ModelMessage[]): ModelMessage[] {
  const context = backgroundContext.getStore();
  if (!context?.sleepWithdrawn) return messages;

  context.sleepWithdrawn = false;

  return [...messages, { role: 'user', content: WITHDRAWN_NOTE }];
}

async function refuseQuietly(context: BackgroundContext, scheduler: Scheduler, wakeId: string): Promise<void> {
  await scheduler.cancel(context.chatId, wakeId).catch(() => {
    context.withdrawWakeIds = [...(context.withdrawWakeIds ?? []), wakeId];
  });
}
