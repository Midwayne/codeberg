import type { ToolSet } from 'ai';
import { describe, expect, it } from 'vitest';

import { cachedInstructions, deterministicTools, requestProviderOptions } from './cache.js';
import type { ModelProfile } from '../providers/profiles.js';

const anthropic: ModelProfile = {
  provider: 'anthropic',
  modelId: 'claude-opus-4-8',
  contextWindow: 1_000_000,
  cache: 'anthropic',
};
const openai: ModelProfile = {
  provider: 'openai',
  modelId: 'gpt-4o',
  contextWindow: 128_000,
  cache: 'openai',
};
const plain: ModelProfile = {
  provider: 'google',
  modelId: 'gemini',
  contextWindow: 1_000_000,
  cache: 'none',
};

describe('cachedInstructions', () => {
  it('marks an ephemeral cache breakpoint for anthropic', () => {
    const ins = cachedInstructions('SYS', anthropic);
    expect(ins).toMatchObject({
      role: 'system',
      content: 'SYS',
      providerOptions: {
        anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } },
      },
    });
  });

  it('leaves the system prompt a plain string for openai/none', () => {
    expect(cachedInstructions('SYS', openai)).toBe('SYS');
    expect(cachedInstructions('SYS', plain)).toBe('SYS');
  });
});

describe('requestProviderOptions', () => {
  it('pins a stable openai promptCacheKey from the prefix', () => {
    const a = requestProviderOptions('SYS', ['b', 'a'], openai);
    const b = requestProviderOptions('SYS', ['b', 'a'], openai);
    expect(a?.openai?.promptCacheKey).toBeDefined();
    expect(a).toEqual(b); // deterministic across calls
  });

  it('changes the key when the prefix changes', () => {
    const a = requestProviderOptions('SYS', ['a'], openai);
    const b = requestProviderOptions('SYS2', ['a'], openai);
    expect(a?.openai?.promptCacheKey).not.toBe(b?.openai?.promptCacheKey);
  });

  it('returns undefined when there is no key-based caching', () => {
    expect(requestProviderOptions('SYS', [], anthropic)).toBeUndefined();
    expect(requestProviderOptions('SYS', [], plain)).toBeUndefined();
  });
});

describe('deterministicTools', () => {
  it('orders tools by name', () => {
    const tools = { zebra: {}, apple: {}, mango: {} } as unknown as ToolSet;
    expect(Object.keys(deterministicTools(tools))).toEqual(['apple', 'mango', 'zebra']);
  });
});
