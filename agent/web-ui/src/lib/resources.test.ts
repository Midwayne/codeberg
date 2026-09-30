import { describe, expect, it } from 'vitest';
import { mergeResourceUsage, type ResourceSample, type ResourceUsage } from './resources';

function usage(timestamp: number, history: number[], collectorId = 'one'): ResourceUsage {
  return { current: { timestamp } as ResourceSample, history: history.map((timestamp) => ({ timestamp }) as ResourceSample),
    retentionMs: 3_600_000, sampleIntervalMs: 10_000, collector: 'daemon', collectorId };
}

describe('incremental resource history', () => {
  it('merges new points without losing earlier history or duplicating the current point', () => {
    const before = usage(20_000, [10_000, 20_000]);
    const merged = mergeResourceUsage(before, usage(30_000, [30_000]));
    expect(merged.history.map((row) => row.timestamp)).toEqual([10_000, 20_000, 30_000]);
    const diskUpdate = { ...usage(30_000, []), current: { timestamp: 30_000, disk: { codebergBytes: 123 } } as ResourceSample };
    expect(mergeResourceUsage(merged, diskUpdate).history.at(-1)?.disk?.codebergBytes).toBe(123);
  });

  it('expires old points, bounds history, and resets when the collector restarts', () => {
    const old = usage(4_000_000, Array.from({ length: 400 }, (_, i) => i * 10_000));
    const merged = mergeResourceUsage(old, usage(4_010_000, [4_010_000]));
    expect(merged.history.length).toBeLessThanOrEqual(360);
    expect(merged.history[0]?.timestamp).toBeGreaterThan(410_000);
    expect(mergeResourceUsage(merged, usage(4_020_000, [4_020_000], 'two')).history.map((row) => row.timestamp)).toEqual([4_020_000]);
  });
});
