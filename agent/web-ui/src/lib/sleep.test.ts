import { describe, expect, it } from 'vitest';

import { sleepView } from './sleep';

const now = Date.parse('2026-11-22T10:00:00Z');
const part = (over: Record<string, unknown> = {}) => ({ type: 'tool-sleep_agent', state: 'output-available',
  input: { prompt: 'Read the reports', delay_seconds: 600, job_ids: ['job-1'] },
  output: { sleeping: true, wake: { id: 'wake-1', status: 'scheduled', dueAt: now + 600_000, backgroundJobIds: ['job-1'] } },
  ...over });

describe('sleepView', () => {
  it('counts down to the wake-up and says it wakes early when the jobs finish', () => {
    const view = sleepView(part(), undefined, now);

    expect(view).toMatchObject({ phase: 'sleeping', prompt: 'Read the reports', dueAt: now + 600_000 });
    expect(view?.label).toBe('Sleeping · wakes in 10m');
    expect(view?.detail).toBe('or as soon as 1 background job finishes');
  });

  it('follows the live schedule: waking, awake, cancelled, or failed', () => {
    const job = (status: string, extra = {}) => [{ id: 'wake-1', status, ...extra }] as never;

    expect(sleepView(part(), job('running'), now)?.label).toBe('Waking up…');
    expect(sleepView(part(), job('completed'), now)?.label).toBe('Woke up');
    expect(sleepView(part(), job('cancelled'), now)?.label).toBe('Wake-up cancelled');
    expect(sleepView(part(), job('failed', { error: 'boom' }), now)).toMatchObject({ phase: 'failed', detail: 'boom' });
  });

  it('reads as awake once its time has passed and the schedule is gone', () => {
    expect(sleepView(part(), [], now + 700_000)?.phase).toBe('awake');
  });

  it('shows a pending sleep while saving and nothing for a refused one', () => {
    expect(sleepView(part({ state: 'input-available', output: undefined }), undefined, now)?.label).toBe('Going to sleep…');
    expect(sleepView(part({ state: 'output-error', output: undefined }), undefined, now)).toBeUndefined();
  });
});
