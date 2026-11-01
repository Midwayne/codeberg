import { scheduleContext } from '../schedules/context.js';
import { currentBackground } from './context.js';

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
    if (wake && typeof wake === 'object' && 'id' in wake && typeof wake.id === 'string') context.sleepWakeId = wake.id;
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
