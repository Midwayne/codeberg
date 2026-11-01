import { expect, it } from 'vitest';
import type { ScheduleSummary } from '@agent/core/schedules/summary';
import { chatHasActiveSchedule } from './schedule-summary';

const job: ScheduleSummary = { id: 'job', chatId: 'chat', chatTitle: 'Review', chatDeleted: false,
  prompt: 'Review changes', status: 'scheduled', createdAt: 1 };

it('marks only the owning chat while a schedule or its occurrence is active', () => {
  expect(chatHasActiveSchedule([job], 'chat')).toBe(true);
  expect(chatHasActiveSchedule([job], 'other')).toBe(false);
  expect(chatHasActiveSchedule([{ ...job, status: 'completed' }], 'chat')).toBe(false);
  expect(chatHasActiveSchedule([{ ...job, status: 'cancelled', activeRun: { id: 'run', stopping: true } }], 'chat')).toBe(true);
  expect(chatHasActiveSchedule(undefined, 'chat')).toBe(false);
});
