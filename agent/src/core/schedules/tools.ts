import { jsonSchema, tool } from 'ai';
import type { ToolSource } from '../tools/source.js';
import { currentScheduleContext, type ScheduleInput } from './context.js';

export function scheduleToolSource(): ToolSource {
  return { name: 'schedules', tools: () => ({
    schedule_run: tool({
      description: 'Schedule a follow-up in this chat only when the user requests it. Supply exactly one of run_at (ISO timestamp with timezone), delay_seconds, or after_tool_call_id (a tool call in this turn). Optional every_seconds repeats time-based schedules at intervals of at least 60 seconds. The prompt should describe the work for each occurrence, without instructions to create another schedule. The server must be running; missed intervals coalesce. Runs use the latest history after the active turn finishes. Tool triggers require a durable outcome; uncertain calls are never repeated. Scheduling does not stop this turn; finish your response after setting up a follow-up. Further runs incur normal model/tool costs.',
      inputSchema: jsonSchema<ScheduleInput>({ type: 'object', properties: {
        prompt: { type: 'string', minLength: 1, maxLength: 16_000 },
        run_at: { type: 'string', description: 'Future ISO 8601 timestamp including Z or an explicit offset.' },
        delay_seconds: { type: 'number', exclusiveMinimum: 0 },
        every_seconds: { type: 'number', minimum: 60 },
        after_tool_call_id: { type: 'string', minLength: 1, maxLength: 256 },
      }, required: ['prompt'], additionalProperties: false }),
      execute: (input) => {
        const context = currentScheduleContext();

        return context.scheduler.create(context, input);
      },
    }),
    list_scheduled_runs: tool({
      description: 'List this chat’s schedules, their status, next due time, last run and errors.',
      inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {}, additionalProperties: false }),
      execute: () => {
        const context = currentScheduleContext();

        return context.scheduler.list(context.chatId);
      },
    }),
    cancel_scheduled_run: tool({
      description: 'Cancel a schedule in this chat, preventing future occurrences. An already started turn continues; use Stop to stop that turn.',
      inputSchema: jsonSchema<{ id: string }>({ type: 'object', properties: {
        id: { type: 'string' },
      }, required: ['id'], additionalProperties: false }),
      execute: ({ id }) => {
        const context = currentScheduleContext();

        return context.scheduler.cancel(context.chatId, id);
      },
    }),
  }) };
}
