import type { Instructions, ModelMessage, ToolSet } from 'ai';

import type { ModelProfile } from '../providers/profiles.js';

/** FNV-1a over the cacheable prefix -> a short, stable id used as OpenAI's
 *  promptCacheKey so repeated requests route to the same cache shard. */
function stableKey(parts: string[]): string {
  const joined = parts.join('|');
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
export function cachedInstructions(system: string, profile: ModelProfile): Instructions {
  if (profile.cache === 'anthropic') {
    return {
      role: 'system',
      content: system,
      providerOptions: {
        anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } },
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
  if (profile.cache === 'openai') {
    return {
      openai: {
        promptCacheKey: `codeberg-${stableKey([system, ...toolNames])}`,
        promptCacheRetention: '24h',
      },
    };
  }

  return undefined;
}

/**
 * Anthropic only caches up to an explicit breakpoint, and the system prompt is
 * the only one `cachedInstructions` sets. Without more, every tool round
 * re-bills the whole transcript (all earlier tool results) at the full input
 * rate. Mark two rolling breakpoints on the transcript tail:
 *
 * - the last message, which writes this step's prefix to the cache;
 * - the message that ended the previous step (just before the latest
 *   assistant turn), which reads what the previous step wrote even when a
 *   step adds more blocks than the provider's lookback window.
 *
 * Together with the system breakpoint that is 3 of Anthropic's 4. Other cache
 * strategies return the input unchanged.
 */
export function withConversationCache(
  messages: ModelMessage[],
  profile: ModelProfile,
): ModelMessage[] {
  if (profile.cache !== 'anthropic' || messages.length === 0) {
    return messages;
  }

  // The tool loop carries each step's prepared messages into the next, so
  // breakpoints from earlier steps must be cleared or they pile up past the
  // provider limit, which then ignores the newest (most valuable) ones.
  const targets = tailBreakpoints(messages);

  return messages.map((message, i) =>
    targets.has(i) ? withCacheBreakpoint(message) : withoutCacheBreakpoint(message),
  );
}

function tailBreakpoints(messages: readonly ModelMessage[]): Set<number> {
  const last = messages.length - 1;

  let lastAssistant = -1;
  for (let i = last; i >= 0; i--) {
    if (messages[i]!.role === 'assistant') {
      lastAssistant = i;
      break;
    }
  }

  const previousStep = lastAssistant - 1;
  const candidates = previousStep >= 0 ? [last, previousStep] : [last];

  return new Set(candidates.filter((i) => messages[i]!.role !== 'system'));
}

function withCacheBreakpoint(message: ModelMessage): ModelMessage {
  const anthropic = message.providerOptions?.anthropic;

  return {
    ...message,
    providerOptions: {
      ...message.providerOptions,
      anthropic: { ...anthropic, cacheControl: { type: 'ephemeral' } },
    },
  } as ModelMessage;
}

function withoutCacheBreakpoint(message: ModelMessage): ModelMessage {
  const anthropic = message.providerOptions?.anthropic;
  if (!anthropic || !('cacheControl' in anthropic)) {
    return message;
  }

  const { cacheControl: _cleared, ...rest } = anthropic;
  const { anthropic: _old, ...others } = message.providerOptions!;
  const providerOptions = Object.keys(rest).length > 0 ? { ...others, anthropic: rest } : others;

  const { providerOptions: _previous, ...bare } = message;

  return (
    Object.keys(providerOptions).length > 0 ? { ...bare, providerOptions } : bare
  ) as ModelMessage;
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
