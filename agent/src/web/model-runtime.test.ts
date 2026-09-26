import type { LanguageModel, ToolLoopAgent } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';

import { ModelAgentPool, createLearningGenerator } from './model-runtime.js';
import type { ModelSelection, ModelSettingsStore } from './model-settings.js';

describe('model runtime', () => {
  it('applies max effort to the selected background learning model', async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => ({
      content: [{ type: 'text', text: 'ok' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
      warnings: [],
    }) });
    const settings = { current: async () => ({
      learning: { key: 'openai:high-context', effort: 'max' },
      models: [{ key: 'openai:high-context', model: 'openai:gpt-5.6-sol', contextWindow: 128000 }],
    }) } as ModelSettingsStore;
    await createLearningGenerator(settings, () => model).generate({ system: 'extract', prompt: 'evidence' });
    expect(model.doGenerateCalls[0].providerOptions?.openai?.reasoningEffort).toBe('max');
    expect(model.doGenerateCalls[0].reasoning).toBeUndefined();
  });

  it('reuses a chat loop only for the same model, effort and context window', async () => {
    const build = vi.fn(async () => ({} as ToolLoopAgent));
    const pool = new ModelAgentPool({ build });
    const alpha = { key: 'openai:alpha', model: 'openai:alpha', effort: 'low' as const, contextWindow: 50_000 };
    const beta = { key: 'openai:beta', model: 'openai:beta', effort: 'high' as const, contextWindow: 90_000 };
    expect(await pool.forSelection(alpha)).toBe(await pool.forSelection(alpha));
    await pool.forSelection(beta);
    await pool.forSelection({ ...alpha, contextWindow: 60_000 });
    expect(build).toHaveBeenCalledTimes(3);
    expect(build).toHaveBeenNthCalledWith(2, beta);
  });

  it('resolves the learning model and effort when each background job starts', async () => {
    let learning: ModelSelection = { key: 'openai:alpha', effort: 'low' };
    const settings = { current: async () => ({ learning, models: [
      { key: 'openai:alpha', model: 'openai:alpha', contextWindow: 50_000 },
      { key: 'openai:beta', model: 'openai:beta', contextWindow: 90_000 },
    ] }) } as ModelSettingsStore;
    const models = new Map<string, MockLanguageModelV4>();
    const resolve = vi.fn((spec: string): LanguageModel => {
      const model = new MockLanguageModelV4({ doGenerate: async () => ({
        content: [{ type: 'text', text: spec }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
        warnings: [],
      }) });
      models.set(spec, model);
      return model;
    });
    const generator = createLearningGenerator(settings, resolve);
    expect(await generator.generate({ system: 'extract', prompt: 'first' })).toBe('openai:alpha');
    learning = { key: 'openai:beta', effort: 'high' };
    expect(await generator.generate({ system: 'extract', prompt: 'second' })).toBe('openai:beta');
    expect(resolve).toHaveBeenCalledWith('openai:beta');
    expect(models.get('openai:beta')?.doGenerateCalls[0].reasoning).toBe('high');
  });

  it('bounds oversized learning evidence to the selected context window', async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => ({
      content: [{ type: 'text', text: 'ok' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
      warnings: [],
    }) });
    let learning: ModelSelection = { key: 'openai:compact', effort: 'none' };
    const settings = { current: async () => ({
      learning,
      models: [
        { key: 'openai:compact', model: 'openai:shared', contextWindow: 1024 },
        { key: 'openai:wide', model: 'openai:shared', contextWindow: 100000 },
      ],
    }) } as ModelSettingsStore;
    const generator = createLearningGenerator(settings, () => model);
    const prompt = {
      system: 'extract',
      prompt: `leading evidence ${'x'.repeat(20_000)} trailing correction`,
    };
    await generator.generate(prompt);
    const sent = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(sent.length).toBeLessThan(6_000);
    expect(sent).toContain('leading evidence');
    expect(sent).toContain('trailing correction');
    learning = { key: 'openai:wide', effort: 'none' };
    await generator.generate(prompt);
    expect(JSON.stringify(model.doGenerateCalls[1].prompt).length).toBeGreaterThan(20_000);
  });
});
