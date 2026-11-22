import { scheduleContext } from '../schedules/context.js';
import { currentBackground, subagentsThisStep, type BackgroundContext } from './context.js';

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
