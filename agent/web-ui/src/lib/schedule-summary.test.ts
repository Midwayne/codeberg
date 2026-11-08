import { expect, it } from 'vitest';
import type { ScheduleSummary } from '@agent/core/schedules/summary';

import { isActiveSchedule } from './schedule-summary';

const job: ScheduleSummary = {
  id: 'job',
  chatId: 'chat',
  chatTitle: 'Review',
  chatDeleted: false,
  prompt: 'Review changes',
  status: 'scheduled',
  createdAt: 1,
};

it('treats a scheduled job or a still-active occurrence as active', () => {
  expect(isActiveSchedule(job)).toBe(true);
  expect(isActiveSchedule({ ...job, status: 'running' })).toBe(true);
  expect(isActiveSchedule({ ...job, status: 'completed' })).toBe(false);
  expect(isActiveSchedule({ ...job, status: 'cancelled', activeRun: { id: 'run', stopping: true } })).toBe(true);
});
