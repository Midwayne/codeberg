import type { ModelMessage, ToolSet } from 'ai';
import { describe, expect, it } from 'vitest';

import type { ModelProfile } from '../providers/profiles.js';
import {
  cachedInstructions,
  deterministicTools,
  requestProviderOptions,
  withConversationCache,
} from './cache.js';

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

describe('withConversationCache', () => {
  const breakpoint = { anthropic: { cacheControl: { type: 'ephemeral' } } };

  const toolStep: ModelMessage[] = [
    { role: 'user', content: 'where is chunking?' },
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 't1', toolName: 'grep', input: {} }],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 't1',
          toolName: 'grep',
          output: { type: 'text', value: 'core/src/chunk.c:12' },
        },
      ],
    },
  ];

  it('marks the tail and the end of the previous step for anthropic', () => {
    const out = withConversationCache(toolStep, anthropic);

    expect(out[0]?.providerOptions).toEqual(breakpoint);
    expect(out[1]?.providerOptions).toBeUndefined();
    expect(out[2]?.providerOptions).toEqual(breakpoint);
  });

  it('marks only the question on the first step', () => {
    const out = withConversationCache([{ role: 'user', content: 'hi' }], anthropic);

    expect(out[0]?.providerOptions).toEqual(breakpoint);
  });

  it('keeps existing provider options and does not mutate the input', () => {
    const messages: ModelMessage[] = [
      {
        role: 'user',
        content: 'hi',
        providerOptions: { anthropic: { other: true }, openai: { x: 1 } },
      },
    ];

    const out = withConversationCache(messages, anthropic);

    expect(out[0]?.providerOptions).toEqual({
      anthropic: { other: true, cacheControl: { type: 'ephemeral' } },
      openai: { x: 1 },
    });
    expect(messages[0]?.providerOptions).toEqual({
      anthropic: { other: true },
      openai: { x: 1 },
    });
  });

  it('clears breakpoints left by earlier steps so they stay within the provider limit', () => {
    const stepOne = withConversationCache(toolStep, anthropic);
    const stepTwo = withConversationCache(
      [
        ...stepOne,
        {
          role: 'assistant',
          content: [{ type: 'tool-call', toolCallId: 't2', toolName: 'grep', input: {} }],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 't2',
              toolName: 'grep',
              output: { type: 'text', value: 'core/src/embed.c:4' },
            },
          ],
        },
      ],
      anthropic,
    );

    const marked = stepTwo.flatMap((message, i) => (message.providerOptions ? [i] : []));

    expect(marked).toEqual([2, 4]);
  });

  it('returns the same array for providers without breakpoint caching', () => {
    expect(withConversationCache(toolStep, openai)).toBe(toolStep);
    expect(withConversationCache(toolStep, plain)).toBe(toolStep);
  });
});

describe('deterministicTools', () => {
  it('orders tools by name', () => {
    const tools = { zebra: {}, apple: {}, mango: {} } as unknown as ToolSet;
    expect(Object.keys(deterministicTools(tools))).toEqual(['apple', 'mango', 'zebra']);
  });
});
