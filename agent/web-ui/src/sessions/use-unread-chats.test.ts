import type { ScheduleSummary } from '@agent/core/schedules/summary';
import { describe, expect, it } from 'vitest';

import { scheduledRunVersion } from './use-unread-chats';

function job(overrides: Partial<ScheduleSummary>): ScheduleSummary {
  return { id: 'job', chatId: 'chat', chatTitle: 'Chat', chatDeleted: false, prompt: 'check', status: 'scheduled', createdAt: 1, ...overrides };
}

describe('scheduledRunVersion', () => {
  it('changes when a scheduled run starts or finishes', () => {
    const waiting = scheduledRunVersion([job({})]);
    const running = scheduledRunVersion([job({ status: 'running', activeRun: { id: 'r1', stopping: false } })]);
    const done = scheduledRunVersion([job({ status: 'completed', lastRunId: 'r1' })]);

    expect(new Set([waiting, running, done]).size).toBe(3);
  });

  it('ignores background tools and job order', () => {
    const a = job({ id: 'a', chatId: 'one' });
    const b = job({ id: 'b', chatId: 'two' });

    expect(scheduledRunVersion([a, b])).toBe(scheduledRunVersion([b, a]));
    expect(scheduledRunVersion([job({ kind: 'background', status: 'running' })])).toBe('');
  });
});
