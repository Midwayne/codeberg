import type { LanguageModelV4CallOptions, LanguageModelV4Message } from '@ai-sdk/provider';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, expect, it, vi } from 'vitest';

import { ContextStore } from '../context/store.js';
import { liveContextModel } from './live-model.js';

afterEach(() => vi.useRealTimers());

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

function longToolHistory(count: number): LanguageModelV4CallOptions {
  const steps = Array.from({ length: count }, (_, index): LanguageModelV4Message[] => [
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: `c${index}`, toolName: 'grep', input: { index } }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: `c${index}`, toolName: 'grep', output: { type: 'text', value: `match ${index} `.repeat(3000) } }] },
  ]).flat();

  return { prompt: [{ role: 'system', content: 'SYS' }, { role: 'user', content: [{ type: 'text', text: 'where?' }] }, ...steps] };
}

it('times only the provider request, not the summary written to make room for it', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const provider = new MockLanguageModelV4({ doGenerate: async () => ({ content: [{ type: 'text', text: 'answer' }],
    finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] }) });

  // Summarizing takes longer than the whole request window.
  const summarize = vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5_000));

    return 'Earlier work: grep found matches in every file.';
  });
  const model = liveContextModel(provider, {
    profile: { provider: 'test', modelId: 'test', contextWindow: 12_000, cache: 'none' as const },
    context: ContextStore.open(mkdtempSync(join(tmpdir(), 'codeberg-live-model-'))),
    summarize,
  }, { requestMs: 1_000, idleMs: 1_000, retries: 0 });

  let settled = false;
  const result = Promise.resolve(model.doGenerate(longToolHistory(60))).finally(() => {
    settled = true;
  });

  while (!settled) {
    await vi.advanceTimersByTimeAsync(500);
    await new Promise((resolve) => setImmediate(resolve));
  }

  expect((await result).content).toEqual([{ type: 'text', text: 'answer' }]);
  expect(summarize).toHaveBeenCalled();
  expect(provider.doGenerateCalls).toHaveLength(1);
}, 30_000);
