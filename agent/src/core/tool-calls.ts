import type { JSONValue } from 'ai';

type ProviderOptions = Record<string, Record<string, JSONValue>>;

/** Shallow-merge per-provider option objects; later parts win per key. */
export function mergeProviderOptions(
  ...parts: readonly (ProviderOptions | undefined)[]
): ProviderOptions | undefined {
  let out: ProviderOptions | undefined;
  for (const part of parts) {
    if (!part) continue;

    out ??= {};
    for (const [provider, options] of Object.entries(part)) {
      out[provider] = { ...out[provider], ...options };
    }
  }

  return out;
}
