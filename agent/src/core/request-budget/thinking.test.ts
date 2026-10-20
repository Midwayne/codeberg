import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

import { ContextStore } from '../context/store.js';
import { manageContextModel } from './model.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface WireRequest {
  max_tokens: number;
  thinking?: { type: string; budget_tokens?: number };
  messages: unknown[];
}

function fixture(modelId = 'claude-haiku-4-5', window = 200000) {
  const root = mkdtempSync(join(tmpdir(), 'cberg-thinking-budget-'));
  roots.push(root);

  const requests: WireRequest[] = [];
  const fetch = vi.fn(async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    requests.push(request);

    if (request.stream) return new Response('', { headers: { 'content-type': 'text/event-stream' } });

    return Response.json({
      id: 'msg_test', type: 'message', role: 'assistant', model: modelId,
      content: [{ type: 'text', text: 'Done' }], stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 1 },
    });
  });
  const raw = createAnthropic({ apiKey: 'test', fetch })(modelId);
  const summarize = vi.fn(async () => 'Earlier work completed.');
  const model = manageContextModel(raw, {
    // The catalog key can differ from the actual provider model ID.
    profile: { provider: 'anthropic', modelId: 'catalog-alias', contextWindow: window, cache: 'none' },
    context: ContextStore.open(root),
    summarize,
  });

  return { model, summarize, requests, fetch };
}

function request(settings: Partial<LanguageModelV4CallOptions> = {}): LanguageModelV4CallOptions {
  return { prompt: [
    { role: 'user', content: [{ type: 'text', text: 'Earlier question' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(600000) }] },
    { role: 'user', content: [{ type: 'text', text: 'Continue' }] },
  ], ...settings };
}

it.each(['generate', 'stream'] as const)('reserves the actual thinking allocation for %s requests', async (mode) => {
  const { model, summarize, requests } = fixture();
  const input = request({ reasoning: 'xhigh' });

  if (mode === 'generate') await model.doGenerate(input);
  else await model.doStream(input);

  const sent = requests[0]!;

  expect(sent.max_tokens).toBe(64000);
  expect(sent.thinking?.budget_tokens).toBe(57600);
  expect(Math.ceil(JSON.stringify(sent.messages).length / 4) + sent.max_tokens).toBeLessThanOrEqual(170000);
  expect(summarize).toHaveBeenCalledOnce();
});

it('reserves an explicit thinking budget even without a top-level reasoning effort', async () => {
  const { model, summarize, requests } = fixture();

  await model.doGenerate(request({ providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 50000 } } } }));

  expect(requests[0]?.max_tokens).toBe(58192);
  expect(requests[0]?.thinking?.budget_tokens).toBe(50000);
  expect(summarize).toHaveBeenCalledOnce();
});

it('reserves the SDK default when thinking is enabled without an explicit budget', async () => {
  const { model, summarize, requests } = fixture('claude-haiku-4-5', 4096);
  const input = request({ providerOptions: { anthropic: { thinking: { type: 'enabled' } } } });
  input.prompt[1] = { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(9000) }] };

  await model.doGenerate(input);

  expect(requests[0]?.max_tokens).toBe(1638);
  expect(requests[0]?.thinking?.budget_tokens).toBe(1024);
  expect(summarize).toHaveBeenCalledOnce();
});

it('uses the selected effort allocation when the total is below the model output cap', async () => {
  const { model, summarize, requests } = fixture();

  await model.doGenerate(request({ reasoning: 'high' }));

  expect(requests[0]?.max_tokens).toBe(46592);
  expect(requests[0]?.thinking?.budget_tokens).toBe(38400);
  expect(summarize).toHaveBeenCalledOnce();
});

it('rejects a thinking allocation that cannot fit even an empty history', async () => {
  const { model, fetch } = fixture('claude-haiku-4-5', 32000);
  const input: LanguageModelV4CallOptions = {
    reasoning: 'xhigh', prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
  };

  await expect(model.doGenerate(input)).rejects.toThrow('context');
  expect(fetch).not.toHaveBeenCalled();
});

it.each(['claude-opus-4-8', 'claude-sonnet-4-6'])('keeps adaptive thinking within the existing output reservation for %s', async (id) => {
  const { model, summarize, requests } = fixture(id);

  await model.doGenerate(request({ reasoning: 'high' }));

  expect(requests[0]?.max_tokens).toBe(8192);
  expect(requests[0]?.thinking?.type).toBe('adaptive');
  expect(summarize).not.toHaveBeenCalled();
});

it('respects an explicit disabled thinking override', async () => {
  const { model, summarize, requests } = fixture();

  await model.doGenerate(request({ reasoning: 'xhigh', providerOptions: { anthropic: { thinking: { type: 'disabled' } } } }));

  expect(requests[0]?.max_tokens).toBe(8192);
  expect(requests[0]?.thinking?.type).toBe('disabled');
  expect(summarize).not.toHaveBeenCalled();
});

it('does not reserve a manual budget when the SDK converts it to adaptive thinking', async () => {
  const { model, summarize, requests } = fixture('claude-opus-5-5');

  await model.doGenerate(request({ providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 50000 } } } }));

  expect(requests[0]?.max_tokens).toBe(8192);
  expect(requests[0]?.thinking?.type).toBe('adaptive');
  expect(summarize).not.toHaveBeenCalled();
});

it('does not infer a manual budget when provider effort overrides top-level reasoning', async () => {
  const { model, summarize, requests } = fixture();

  await model.doGenerate(request({ reasoning: 'xhigh', providerOptions: { anthropic: { effort: 'high' } } }));

  expect(requests[0]?.max_tokens).toBe(8192);
  expect(requests[0]?.thinking).toBeUndefined();
  expect(summarize).not.toHaveBeenCalled();
});
