import { describe, expect, it } from 'vitest';

import { profileFor } from '../providers/profiles.js';
import { mergeProviderOptions, parallelToolProviderOptions } from './tool-calls.js';

describe('parallelToolProviderOptions', () => {
  it('turns parallel calls on for every OpenAI-wire provider', () => {
    for (const spec of ['openai:gpt-5', 'ollama:qwen3', 'llamacpp:local']) {
      expect(parallelToolProviderOptions(profileFor(spec, {}))).toEqual({
        openai: { parallelToolCalls: true },
      });
    }
  });

  it('leaves providers that default to parallel calls alone', () => {
    for (const spec of ['anthropic:claude-opus-4-8', 'google:gemini-2.5-pro']) {
      expect(parallelToolProviderOptions(profileFor(spec, {}))).toBeUndefined();
    }
  });
});

describe('mergeProviderOptions', () => {
  it('merges per provider without dropping earlier keys', () => {
    expect(
      mergeProviderOptions(
        { openai: { promptCacheKey: 'k' } },
        undefined,
        { openai: { parallelToolCalls: true } },
        { openai: { reasoningEffort: 'max' }, anthropic: { x: 1 } },
      ),
    ).toEqual({
      openai: { promptCacheKey: 'k', parallelToolCalls: true, reasoningEffort: 'max' },
      anthropic: { x: 1 },
    });
  });

  it('returns undefined when there is nothing to send', () => {
    expect(mergeProviderOptions(undefined, undefined)).toBeUndefined();
  });
});
