import { describe, expect, it } from 'vitest';

import { clockContext } from './clock.js';

describe('clockContext', () => {
  it('names the local date, weekday, and offset', () => {
    const line = clockContext(new Date('2026-11-22T03:00:00Z'), 'America/New_York');

    expect(line).toContain('Today is 2026-11-21 (Saturday) in America/New_York (UTC-05:00).');
  });

  it('writes a zero offset for UTC', () => {
    const line = clockContext(new Date('2026-11-22T03:00:00Z'), 'UTC');

    expect(line).toContain('Today is 2026-11-22 (Sunday) in UTC (UTC+00:00).');
  });

  it('stays byte-identical within one day', () => {
    const morning = clockContext(new Date('2026-11-22T08:00:00Z'), 'UTC');
    const evening = clockContext(new Date('2026-11-22T22:59:00Z'), 'UTC');

    expect(evening).toBe(morning);
  });
});
