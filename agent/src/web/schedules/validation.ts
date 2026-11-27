import { randomUUID } from 'node:crypto';
import type { ScheduleInput } from '../../core/schedules/context.js';
import { isValidSessionId } from '../sessions/records.js';
import { scheduledSelection, type ScheduledRun, type ScheduleOwner } from './types.js';

/** Largest timestamp a Date can hold, in milliseconds. */
const MAX_DATE_MS = 8.64e15;

const ISO_WITH_TIMEZONE = /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(Z|[+-]\d\d:\d\d)$/;

/** Checks run in a fixed order, so the first problem with a request is always the one reported. */
export function newSchedule(owner: ScheduleOwner, input: ScheduleInput, now = Date.now()): ScheduledRun {
  if (!isValidSessionId(owner.chatId) || !isValidSessionId(owner.sourceRunId)) throw new Error('Invalid schedule owner.');

  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 16_000) {
    throw new Error('Supply a follow-up prompt of 1–16000 characters.');
  }

  const triggers = [input.run_at, input.delay_seconds, input.after_tool_call_id].filter((item) => item !== undefined);
  if (triggers.length !== 1) throw new Error('Supply exactly one run_at, delay_seconds or after_tool_call_id.');

  if (!validRepeat(input)) throw new Error('Repeat intervals must be at least 60 seconds and require a time trigger.');
  if (!validBackgroundJobs(input.background_job_ids)) throw new Error('Supply up to 8 background job IDs from this chat.');

  const dueAt = scheduleTime(input, now);
  if (input.every_seconds !== undefined && dueAt! + input.every_seconds * 1000 > MAX_DATE_MS) {
    throw new Error('Repeat interval exceeds the supported date range.');
  }

  if (!validToolCallId(input.after_tool_call_id)) throw new Error('Supply a valid tool call ID from this turn.');

  return {
    chatId: owner.chatId,
    sourceRunId: owner.sourceRunId,
    selection: scheduledSelection(owner.selection),
    id: randomUUID(),
    prompt: input.prompt.trim(),
    dueAt,
    everySeconds: input.every_seconds,
    afterToolCallId: input.after_tool_call_id,
    backgroundJobIds: input.background_job_ids,
    status: 'scheduled',
    occurrence: 0,
    createdAt: now,
  };
}

function validRepeat(input: ScheduleInput): boolean {
  if (input.every_seconds === undefined) return true;

  return Number.isFinite(input.every_seconds) && input.every_seconds >= 60 && input.after_tool_call_id === undefined;
}

function validBackgroundJobs(ids: ScheduleInput['background_job_ids']): boolean {
  if (ids === undefined) return true;

  return Array.isArray(ids) && ids.length <= 8 && ids.every((id) => typeof id === 'string');
}

function validToolCallId(id: ScheduleInput['after_tool_call_id']): boolean {
  if (id === undefined) return true;

  return typeof id === 'string' && Boolean(id.trim()) && id.length <= 256;
}

function scheduleTime(input: ScheduleInput, now: number): number | undefined {
  if (input.after_tool_call_id !== undefined) return undefined;

  if (input.run_at !== undefined && (typeof input.run_at !== 'string' || !ISO_WITH_TIMEZONE.test(input.run_at))) {
    throw new Error('run_at must be an ISO timestamp with an explicit timezone.');
  }

  const dueAt = input.run_at !== undefined ? Date.parse(input.run_at) : now + input.delay_seconds! * 1000;
  if (!Number.isFinite(dueAt) || dueAt <= now || dueAt > MAX_DATE_MS) throw new Error('Schedule time must be in the future.');

  return dueAt;
}
