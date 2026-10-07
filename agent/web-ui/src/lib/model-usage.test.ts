import { describe, expect, it } from 'vitest';
import { usageRange, usageQuery, formatCost } from './model-usage';

describe('usage ranges', () => {
  it('uses UTC calendar days for presets, including month and year boundaries', () => {
    const now = new Date('2026-01-01T23:50:00-05:00');

    expect(usageRange('1d', now)).toEqual({ start: '2026-01-02', end: '2026-01-03' });
    expect(usageRange('7d', now)).toEqual({ start: '2025-12-27', end: '2026-01-03' });
    expect(usageRange('mtd', now)).toEqual({ start: '2026-01-01', end: '2026-01-03' });
    expect(usageRange('last-month', now)).toEqual({ start: '2025-12-01', end: '2026-01-01' });
    expect(usageQuery(usageRange('7d', now), 2)).toContain('page=2');
  });

  it('distinguishes unavailable cost from zero and preserves small charges', () => {
    expect(formatCost(null)).toBe('Unavailable');
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(0.00003)).toBe('<$0.0001');
    expect(formatCost(0.00333)).toBe('$0.0033');
  });
});
