import { gateway, ToolLoopAgent } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

import { ContextStore } from '../context/store.js';
import { manageContextModel } from './model.js';

const roots: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();

  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function options() {
  const root = mkdtempSync(join(tmpdir(), 'cberg-model-resolution-'));
  roots.push(root);

  return {
    profile: { provider: 'test', modelId: 'test', contextWindow: 4096, cache: 'none' as const },
    context: ContextStore.open(root),
    summarize: vi.fn(async () => 'Checkpoint'),
  };
}

it('resolves string identifiers through the SDK gateway by default', () => {
  vi.stubGlobal('AI_SDK_DEFAULT_PROVIDER', undefined);
  const expected = gateway.languageModel('openai/gpt-4o');

  const model = manageContextModel('openai/gpt-4o', options());

  expect(model.provider).toBe(expected.provider);
  expect(model.modelId).toBe(expected.modelId);
});

it('uses the configured default provider and keeps request budgets in the tool loop', async () => {
  const raw = new MockLanguageModelV4({ doGenerate: async () => ({
    content: [{ type: 'text', text: 'Done' }],
    finishReason: { unified: 'stop', raw: undefined },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
  }) });
  const languageModel = vi.fn(() => raw);
  vi.stubGlobal('AI_SDK_DEFAULT_PROVIDER', { specificationVersion: 'v4', languageModel });

  const loop = new ToolLoopAgent({ model: manageContextModel('custom/chat', options()) });
  const result = await loop.generate({ prompt: 'Hello' });

  expect(languageModel).toHaveBeenCalledWith('custom/chat');
  expect(result.text).toBe('Done');
  expect(raw.doGenerateCalls).toHaveLength(1);
  expect(raw.doGenerateCalls[0]?.maxOutputTokens).toBe(614);
});
