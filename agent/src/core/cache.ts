import type { Instructions, ToolSet } from "ai";

import type { ModelProfile } from "../providers/profiles.js";

/** FNV-1a over the cacheable prefix -> a short, stable id used as OpenAI's
 *  promptCacheKey so repeated requests route to the same cache shard. */
function stableKey(parts: string[]): string {
  const joined = parts.join("|");
  let h = 2166136261;
  for (let i = 0; i < joined.length; i++) {
    h ^= joined.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * Wrap the large, frozen system prompt so the provider caches it instead of
 * re-billing it on every tool round and every turn. Anthropic needs an explicit
 * `cacheControl` breakpoint (1h TTL survives the gaps between turns); OpenAI
 * caches matching prefixes automatically, so there the system prompt stays a
 * plain string and the cache key is pinned on the request options instead.
 * Either way the prompt text is byte-identical across calls - the precondition
 * for any prefix cache to hit.
 */
export function cachedInstructions(
  system: string,
  profile: ModelProfile,
): Instructions {
  if (profile.cache === "anthropic") {
    return {
      role: "system",
      content: system,
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
      },
    };
  }
  return system;
}

/**
 * Request-level provider options for the agent loop. For OpenAI(-compatible)
 * models we pin a stable `promptCacheKey` derived from the cacheable prefix so
 * the automatic prefix cache is hit reliably across turns. Returns undefined
 * when the model has no key-based caching to configure.
 */
export function requestProviderOptions(
  system: string,
  toolNames: string[],
  profile: ModelProfile,
): Record<string, Record<string, string>> | undefined {
  if (profile.cache === "openai") {
    return {
      openai: {
        promptCacheKey: `codeberg-${stableKey([system, ...toolNames])}`,
        promptCacheRetention: "24h",
      },
    };
  }
  return undefined;
}

/**
 * Tool order is part of the cached prefix: a reordered tool list invalidates
 * the whole cache. The daemon's tool list has no guaranteed order, so sort by
 * name to keep the prefix byte-stable across runs and processes.
 */
export function deterministicTools(tools: ToolSet): ToolSet {
  const sorted: ToolSet = {};
  for (const name of Object.keys(tools).sort()) {
    sorted[name] = tools[name]!;
  }
  return sorted;
}
