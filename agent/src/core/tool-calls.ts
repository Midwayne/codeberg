import type { JSONValue } from 'ai';

import type { ModelProfile } from '../providers/profiles.js';

type ProviderOptions = Record<string, Record<string, JSONValue>>;

/**
 * Ask OpenAI-wire servers for several tool calls per response. OpenAI enables
 * this by default, but llama.cpp's server defaults `parallel_tool_calls` to
 * false, so every lookup would cost a separate step. Anthropic and Gemini
 * allow parallel calls unless told otherwise.
 */
export function parallelToolProviderOptions(profile: ModelProfile): ProviderOptions | undefined {
  switch (profile.provider) {
    case 'openai':
    case 'ollama':
    case 'llamacpp':
      return { openai: { parallelToolCalls: true } };
    default:
      return undefined;
  }
}

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
