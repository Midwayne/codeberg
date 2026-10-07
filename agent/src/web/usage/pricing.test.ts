import { describe, expect, it } from 'vitest';
import { parsePricing } from './pricing.js';

describe('catalog pricing', () => {
  it('accepts explicit zero rates and optional cache pricing in USD per million', () => {
    expect(parsePricing({ input: 0, output: 0, cache_read: 0, cache_write: 0 }, 'custom:local'))
      .toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(parsePricing(undefined, 'custom:model')).toBeUndefined();
  });

  it('rejects missing, negative, non-numeric and non-finite rates', () => {
    for (const pricing of [null, [], { input: 1 }, { input: -1, output: 2 },
      { input: '1', output: 2 }, { input: Infinity, output: 2 }, { input: 1, output: 2, cache_read: -0.1 }]) {
      expect(() => parsePricing(pricing, 'custom:model')).toThrow(/invalid pricing/);
    }
  });
});
