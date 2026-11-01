import { AsyncLocalStorage } from 'node:async_hooks';

export interface ScheduleInput {
  prompt: string;
  run_at?: string;
  delay_seconds?: number;
  every_seconds?: number;
  after_tool_call_id?: string;
  background_job_ids?: string[];
}

export interface SchedulingService {
  create(context: ScheduleContext, input: ScheduleInput): Promise<unknown>;
  list(chatId: string): Promise<unknown>;
  cancel(chatId: string, id: string): Promise<unknown>;
}

export interface ScheduleContext {
  chatId: string;
  sourceRunId: string;
  scheduler: SchedulingService;
}

/** Resolve per execution because a cached agent can serve several chats. */
export const scheduleContext = new AsyncLocalStorage<ScheduleContext>();

export function currentScheduleContext(): ScheduleContext {
  const context = scheduleContext.getStore();
  if (!context) throw new Error('Scheduled runs require a server-owned browser chat.');

  return context;
}
