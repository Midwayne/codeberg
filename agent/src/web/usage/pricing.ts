import type { ModelPricing } from '../../core/usage.js';

export function parsePricing(value: unknown, key: string): ModelPricing | undefined {
  if (value === undefined) return undefined;

  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`invalid pricing for ${key}`);

  const rates = value as Record<string, unknown>;
  for (const name of ['input', 'output', 'cache_read', 'cache_write']) {
    const rate = rates[name];
    if (rate === undefined && name.startsWith('cache_')) continue;

    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0)
      throw new Error(`invalid pricing.${name} for ${key}`);
  }

  return { input: rates.input as number, output: rates.output as number,
    ...(rates.cache_read !== undefined ? { cacheRead: rates.cache_read as number } : {}),
    ...(rates.cache_write !== undefined ? { cacheWrite: rates.cache_write as number } : {}),
  };
}
