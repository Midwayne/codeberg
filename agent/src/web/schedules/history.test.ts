import { expect, it } from 'vitest';
import { reserveSchedule } from './history.js';
import type { ScheduledRun } from './types.js';

function jobs(status: ScheduledRun['status']): ScheduledRun[] {
  return Array.from({ length: 100 }, (_, index) => ({ id: String(index), chatId: 'chat', sourceRunId: 'run',
    prompt: 'Check work', status, occurrence: 0, createdAt: index }));
}

it('retains recent history while making room for unlimited successive sleeps', () => {
  const stored = [...jobs('completed'), { ...jobs('scheduled')[0]!, chatId: 'other', id: 'other' }];
  const reserved = reserveSchedule(stored, 'chat');

  expect(reserved).toHaveLength(100);
  expect(reserved.some((job) => job.id === '0')).toBe(false);
  expect(reserved.some((job) => job.id === 'other')).toBe(true);
  expect(stored).toHaveLength(101);
});

it('never evicts active schedules to admit another', () => {
  expect(() => reserveSchedule(jobs('scheduled'), 'chat')).toThrow('100 active');
});
