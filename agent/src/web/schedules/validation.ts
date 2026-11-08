import { randomUUID } from 'node:crypto';
import type { ScheduleInput } from '../../core/schedules/context.js';
import { isValidSessionId } from '../../core/api/sessions.js';
import type { ScheduledRun, ScheduleOwner } from './types.js';

export function newSchedule(owner: ScheduleOwner, input: ScheduleInput, now = Date.now()): ScheduledRun {
  if (!isValidSessionId(owner.chatId) || !isValidSessionId(owner.sourceRunId)) throw new Error('Invalid schedule owner.');
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 16_000) {
    throw new Error('Supply a follow-up prompt of 1–16000 characters.');
  }

  const triggers = [input.run_at, input.delay_seconds, input.after_tool_call_id].filter((item) => item !== undefined);
  if (triggers.length !== 1) throw new Error('Supply exactly one run_at, delay_seconds or after_tool_call_id.');
  if (input.every_seconds !== undefined && (!Number.isFinite(input.every_seconds) || input.every_seconds < 60 || input.after_tool_call_id !== undefined)) {
    throw new Error('Repeat intervals must be at least 60 seconds and require a time trigger.');
  }

  if (input.background_job_ids !== undefined && (!Array.isArray(input.background_job_ids) || input.background_job_ids.length > 8 || input.background_job_ids.some((id) => typeof id !== 'string'))) {
    throw new Error('Supply up to 8 background job IDs from this chat.');
  }

  const dueAt = scheduleTime(input, now);
  if (input.every_seconds !== undefined && dueAt! + input.every_seconds * 1000 > 8.64e15) {
    throw new Error('Repeat interval exceeds the supported date range.');
  }
  if (input.after_tool_call_id !== undefined && (typeof input.after_tool_call_id !== 'string' || !input.after_tool_call_id.trim() || input.after_tool_call_id.length > 256)) {
    throw new Error('Supply a valid tool call ID from this turn.');
  }

  return { chatId: owner.chatId, sourceRunId: owner.sourceRunId, selection: owner.selection,
    id: randomUUID(), prompt: input.prompt.trim(), dueAt, everySeconds: input.every_seconds,
    afterToolCallId: input.after_tool_call_id, backgroundJobIds: input.background_job_ids, status: 'scheduled', occurrence: 0, createdAt: now };
}

function scheduleTime(input: ScheduleInput, now: number): number | undefined {
  if (input.after_tool_call_id !== undefined) return undefined;

  if (input.run_at !== undefined && (typeof input.run_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(Z|[+-]\d\d:\d\d)$/.test(input.run_at))) {
    throw new Error('run_at must be an ISO timestamp with an explicit timezone.');
  }
  const dueAt = input.run_at !== undefined ? Date.parse(input.run_at) : now + input.delay_seconds! * 1000;
  if (!Number.isFinite(dueAt) || dueAt <= now || dueAt > 8.64e15) throw new Error('Schedule time must be in the future.');

  return dueAt;
}
