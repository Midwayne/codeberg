import type { ModelPricing, UsageTokens } from '../../core/usage.js';

export function estimateCost(tokens: UsageTokens, rates?: ModelPricing): number | null {
  const { inputTokens: input, outputTokens: output, cacheReadTokens: read, cacheWriteTokens: write } = tokens;
  if (!rates || input === null || output === null) return null;

  // Missing cache detail cannot safely be priced at a different rate.
  if ((rates.cacheRead !== undefined && read === null) || (rates.cacheWrite !== undefined && write === null))
    return null;

  if ((read && rates.cacheRead === undefined) || (write && rates.cacheWrite === undefined)) return null;

  const uncached = input - (read ?? 0) - (write ?? 0);
  if (uncached < 0) return null;

  return (uncached * rates.input + output * rates.output + (read ?? 0) * (rates.cacheRead ?? 0)
    + (write ?? 0) * (rates.cacheWrite ?? 0)) / 1_000_000;
}
