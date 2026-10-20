import { MockLanguageModelV4 } from 'ai/test';
import { expect, it } from 'vitest';

import { fromAiSdk } from './generator.js';

it('passes an optional generation output budget to the provider', async () => {
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text: 'Summary' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }),
  });

  await fromAiSdk(model).generate({ system: 'Summarize', prompt: 'History', maxOutputTokens: 250 });

  expect(model.doGenerateCalls[0]?.maxOutputTokens).toBe(250);

  await fromAiSdk(model).generate({ system: 'Answer', prompt: 'Question' });

  expect(model.doGenerateCalls[1]?.maxOutputTokens).toBeUndefined();
});

it('rejects a truncated checkpoint instead of accepting an incomplete summary', async () => {
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text: 'Partial summary' }],
      finishReason: { unified: 'length', raw: 'max_tokens' },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }),
  });

  await expect(fromAiSdk(model).generate({
    system: 'Summarize',
    prompt: 'History',
    maxOutputTokens: 250,
    requireComplete: true,
  })).rejects.toThrow('incomplete');
});
