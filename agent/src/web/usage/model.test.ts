import { generateText, streamText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import { trackModelUsage } from './model.js';
import type { UsageStore } from './store.js';
import type { UsageRecord } from '../../core/usage.js';

const usage = {
  inputTokens: { total: 1000, noCache: 500, cacheRead: 400, cacheWrite: 100 },
  outputTokens: { total: 200, text: 150, reasoning: 50 },
};
const pricing = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };

describe('usage middleware', () => {
  it('records generated and streamed provider calls exactly once with cache and reasoning usage', async () => {
    const record = vi.fn(async (_row: Omit<UsageRecord, 'id' | 'timestamp'>) => undefined);
    const provider = new MockLanguageModelV4({
      doGenerate: async () => ({ content: [{ type: 'text', text: 'answer' }],
        finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] }),
      doStream: async () => ({ stream: new ReadableStream({ start(controller) {
        controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage });
        controller.close();
      } }) }),
    });
    const model = trackModelUsage(provider, { record } as unknown as UsageStore, {
      model: 'custom:actual', key: 'custom:alias', kind: 'chat', project: 'p-123', projectName: 'Codeberg',
    }, async () => pricing);

    await generateText({ model, prompt: 'hello' });
    await streamText({ model, prompt: 'hello' }).consumeStream();

    expect(record).toHaveBeenCalledTimes(2);
    expect(record.mock.calls[0][0]).toMatchObject({ inputTokens: 1000, outputTokens: 200,
      cacheReadTokens: 400, cacheWriteTokens: 100, costUsd: 0.00333, project: 'p-123', key: 'custom:alias' });
  });

  it('captures new prices for subsequent calls without changing historical estimates', async () => {
    const record = vi.fn(async (_row: Omit<UsageRecord, 'id' | 'timestamp'>) => undefined);
    let input = 2;
    const provider = new MockLanguageModelV4({ doGenerate: async () => ({
      content: [{ type: 'text', text: 'ok' }], finishReason: { unified: 'stop', raw: undefined },
      usage, warnings: [],
    }) });
    const model = trackModelUsage(provider, { record } as unknown as UsageStore,
      { model: 'custom:model', key: 'custom:key', kind: 'learning' }, async () => ({ ...pricing, input }));
    await generateText({ model, prompt: 'hello' });
    input = 4;
    await generateText({ model, prompt: 'hello' });

    expect(record.mock.calls.map(([row]) => row.costUsd)).toEqual([0.00333, 0.00433]);
  });

  it('preserves responses when accounting fails', async () => {
    const record = vi.fn(async () => { throw new Error('disk unavailable'); });
    const provider = new MockLanguageModelV4({ doGenerate: async () => ({
      content: [{ type: 'text', text: 'ok' }], finishReason: { unified: 'stop', raw: undefined },
      usage, warnings: [],
    }) });
    const model = trackModelUsage(provider, { record } as unknown as UsageStore,
      { model: 'custom:model', key: 'custom:key', kind: 'chat' });

    expect((await generateText({ model, prompt: 'hello' })).text).toBe('ok');
  });
});
