import type { LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { expect, it, vi } from 'vitest';

import { summaryGenerator, summaryLanguageModel } from '../../core/summary-model.js';
import type { ModelSettings } from './settings.js';
import { summaryConfig, summaryModel } from './summary.js';

const models: ModelSettings['models'] = [
  { key: 'openai:chat', model: 'openai:big', provider: 'openai', label: 'Chat', contextWindow: 400_000, efforts: ['high'], inputs: ['text'] },
  { key: 'openai:cheap', model: 'openai:small', provider: 'openai', label: 'Cheap', contextWindow: 64_000, efforts: ['low'], inputs: ['text'] },
];

const chat = { key: 'openai:chat', effort: 'high' as const };

function mockModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text: 'summary' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }),
  });
}

it('resolves no summary model until one is chosen', () => {
  expect(summaryModel({ models })).toBeUndefined();
  expect(summaryModel({ models, summary: null })).toBeUndefined();
});

it('resolves the chosen summary model to its wire name and window', () => {
  const summary = { key: 'openai:cheap', effort: 'low' as const };

  expect(summaryModel({ models, summary })).toEqual({
    key: 'openai:cheap',
    model: 'openai:small',
    effort: 'low',
    contextWindow: 64_000,
  });
});

it('summarizes on the chosen model and tracks it under its own key', async () => {
  const cheap = mockModel();
  const resolve = vi.fn((): LanguageModel => cheap);
  const track = vi.fn((model: LanguageModel, _tracked: { key: string; model: string }) => model);
  const summary = { key: 'openai:cheap', model: 'openai:small', effort: 'low' as const, contextWindow: 64_000 };
  const selection = { ...chat, model: 'openai:big', contextWindow: 400_000, summary };

  const config = summaryConfig(selection, track);
  const generator = summaryGenerator(config, summaryLanguageModel(config, resolve));

  expect(await generator!.generate({ system: 'summarize', prompt: 'history' })).toBe('summary');
  expect(resolve).toHaveBeenCalledWith('openai:small');
  expect(track.mock.calls[0]![1]).toMatchObject({ key: 'openai:cheap', model: 'openai:small' });
  expect(cheap.doGenerateCalls[0]!.reasoning).toBe('low');
  expect(config?.contextWindow).toBe(64_000);
});

it('leaves summaries on the chat model when none is chosen', () => {
  const selection = { ...chat, model: 'openai:big', contextWindow: 400_000 };

  expect(summaryConfig(selection)).toBeUndefined();
  expect(summaryGenerator(undefined, mockModel())).toBeUndefined();
});
