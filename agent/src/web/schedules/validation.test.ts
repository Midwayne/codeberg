import { describe, expect, it } from 'vitest';

import type { ScheduleInput } from '../../core/schedules/context.js';
import { newSchedule } from './validation.js';

const owner = { chatId: 'chat', sourceRunId: 'run' };
const now = Date.UTC(2026, 0, 1);

function schedule(input: Partial<ScheduleInput>) {
  return newSchedule(owner, { prompt: 'continue', ...input }, now);
}

describe('newSchedule', () => {
  it('accepts up to eight background job IDs and rejects a ninth', () => {
    const ids = Array.from({ length: 8 }, (_, index) => `job-${index}`);

    expect(schedule({ delay_seconds: 60, background_job_ids: ids }).backgroundJobIds).toEqual(ids);

    expect(() => schedule({ delay_seconds: 60, background_job_ids: [...ids, 'job-8'] })).toThrow(
      /up to 8 background job IDs/,
    );
  });

  it('accepts a tool call ID of 256 characters and rejects a longer or blank one', () => {
    const longest = 'a'.repeat(256);

    expect(schedule({ after_tool_call_id: longest }).afterToolCallId).toBe(longest);

    expect(() => schedule({ after_tool_call_id: `${longest}a` })).toThrow(/valid tool call ID/);
    expect(() => schedule({ after_tool_call_id: '   ' })).toThrow(/valid tool call ID/);
  });

  it('leaves a tool-triggered schedule without a due time', () => {
    expect(schedule({ after_tool_call_id: 'call-1' }).dueAt).toBeUndefined();
  });

  it('reports the repeat interval before the tool call ID when both are wrong', () => {
    expect(() => schedule({ after_tool_call_id: '   ', every_seconds: 120 })).toThrow(/Repeat intervals/);
  });
});
