import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult } from '@ai-sdk/provider';
import { MockLanguageModelV4 } from 'ai/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

import { ContextStore } from './context/store.js';
import { manageContextModel } from './request-budget/model.js';
import { estimateRequest } from './request-budget/estimate.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function reply(): LanguageModelV4GenerateResult {
  return {
    content: [{ type: 'text', text: 'Done' }],
    finishReason: { unified: 'stop', raw: undefined },
    usage: {
      inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 2, text: 2, reasoning: 0 },
    },
    warnings: [],
  };
}

function fixture(doGenerate: (options: LanguageModelV4CallOptions) => Promise<LanguageModelV4GenerateResult> = async () => reply()) {
  const root = mkdtempSync(join(tmpdir(), 'cberg-request-budget-'));
  roots.push(root);

  const raw = new MockLanguageModelV4({ doGenerate });
  const summarize = vi.fn(async () => 'Checkpoint');
  const model = manageContextModel(raw, {
    profile: { provider: 'test', modelId: 'test', contextWindow: 4096, cache: 'none' },
    context: ContextStore.open(root),
    summarize,
  });

  return { model, raw, summarize };
}

function request(): LanguageModelV4CallOptions {
  return {
    prompt: [
      { role: 'system', content: 'instructions '.repeat(150) },
      { role: 'user', content: [{ type: 'text', text: 'old question' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'history '.repeat(1400) }] },
      { role: 'user', content: [{ type: 'text', text: 'current question' }] },
    ],
    tools: [{ type: 'function', name: 'read', description: 'read source '.repeat(200), inputSchema: { type: 'object' } }],
  };
}

it('budgets system text, tool schemas, history, and the reserved answer together', async () => {
  const { model, raw, summarize } = fixture();
  const input = request();

  await model.doGenerate(input);
  const sent = raw.doGenerateCalls[0]!;

  expect(summarize).toHaveBeenCalledOnce();
  expect(sent.tools).toEqual(input.tools);
  expect(sent.prompt[0]).toEqual(input.prompt[0]);
  expect(sent.prompt.at(-1)).toEqual(input.prompt.at(-1));
  expect(estimateRequest(sent) + sent.maxOutputTokens!).toBeLessThanOrEqual(4096);
});

it('counts attachments without treating binary bytes as text', () => {
  const input = request();
  const before = estimateRequest(input);
  input.prompt.push({ role: 'user', content: [
    { type: 'file', mediaType: 'image/png', data: { type: 'data', data: new Uint8Array(2000000) } },
  ] });

  const difference = estimateRequest(input) - before;

  expect(difference).toBeGreaterThanOrEqual(1500);
  expect(difference).toBeLessThan(10000);
});

it('counts JSON business fields even when they resemble media or provider metadata', () => {
  const input: LanguageModelV4CallOptions = { prompt: [{ role: 'tool', content: [{
    type: 'tool-result', toolCallId: '1', toolName: 'read',
    output: { type: 'json', value: { type: 'file', providerOptions: 'x'.repeat(30000) } },
  }] }] };

  expect(estimateRequest(input)).toBeGreaterThan(7500);
});

it('includes a structured-output schema in the request estimate', () => {
  const input: LanguageModelV4CallOptions = {
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'Return JSON' }] }],
    responseFormat: { type: 'json', schema: { type: 'object', description: 'schema details '.repeat(2000) } },
  };

  expect(estimateRequest(input)).toBeGreaterThan(7000);
});

it('retries only a rejected provider request with a smaller transcript', async () => {
  let calls = 0;
  const { model, raw } = fixture(async () => {
    calls++;
    if (calls === 1) throw Object.assign(new Error('maximum context length exceeded'), { code: 'context_length_exceeded' });

    return reply();
  });
  const input = request();
  input.prompt[2] = { role: 'assistant', content: [{ type: 'text', text: 'history '.repeat(300) }] };

  await model.doGenerate(input);

  expect(raw.doGenerateCalls).toHaveLength(2);
  expect(estimateRequest(raw.doGenerateCalls[1]!)).toBeLessThan(estimateRequest(raw.doGenerateCalls[0]!));
});

it('does not retry authentication failures or requests that have been cancelled', async () => {
  const { model, raw } = fixture(async () => { throw new Error('invalid API key'); });

  await expect(model.doGenerate(request())).rejects.toThrow('invalid API key');
  expect(raw.doGenerateCalls).toHaveLength(1);

  await expect(model.doGenerate({ ...request(), abortSignal: AbortSignal.abort() })).rejects.toThrow();
  expect(raw.doGenerateCalls).toHaveLength(1);
});

it('reports an oversized current request without discarding it', async () => {
  const { model, raw } = fixture();
  const input: LanguageModelV4CallOptions = {
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'x'.repeat(100000) }] }],
  };

  await expect(model.doGenerate(input)).rejects.toThrow('current request');
  expect(raw.doGenerateCalls).toHaveLength(0);
});
