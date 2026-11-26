import type { LanguageModelV4Message } from '@ai-sdk/provider';
import { gateway, ToolLoopAgent } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

import { chatScope } from '../chat-scope.js';
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

it('keeps the turn’s question verbatim when a usage notice and history compaction land on one request', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cberg-notice-'));
  roots.push(root);

  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text: 'Done' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
      warnings: [],
    }),
  });
  const managed = manageContextModel(model, {
    profile: { provider: 'test', modelId: 'test', contextWindow: 12_000, cache: 'none' },
    context: ContextStore.open(root),
    summarize: vi.fn(async () => 'Checkpoint'),
  });

  // Large earlier results are cleared (so a notice is due); the many results under
  // 1,000 characters are never cleared, so only a summary can make enough room.
  const step = (id: string, size = 950): LanguageModelV4Message[] => [
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: id, toolName: 'grep', input: {} }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: id, toolName: 'grep', output: { type: 'text', value: `${id} ${'x'.repeat(size)}` } }] },
  ];
  const prompt: LanguageModelV4Message[] = [
    { role: 'system', content: 'SYS' },
    { role: 'user', content: [{ type: 'text', text: 'Earlier question' }] },
    ...Array.from({ length: 10 }, (_, i) => step(`big${i}`, 3_000)).flat(),
    ...Array.from({ length: 40 }, (_, i) => step(`old${i}`)).flat(),
    { role: 'assistant', content: [{ type: 'text', text: 'Earlier answer' }] },
    { role: 'user', content: [{ type: 'text', text: 'QUESTION-NOW' }] },
    ...Array.from({ length: 3 }, (_, i) => step(`new${i}`)).flat(),
  ];

  await chatScope.run(join(root, 'chat-notice'), () => managed.doGenerate({
    prompt,
    tools: [{ type: 'function', name: 'context_status', inputSchema: { type: 'object' } }],
  }));

  const sent = model.doGenerateCalls.at(-1)!.prompt;
  const texts = sent.flatMap((message) => message.role === 'user'
    ? message.content.flatMap((part) => (part.type === 'text' ? [part.text] : []))
    : []);

  expect(texts.at(-1)).toMatch(/^<context_notice>/);
  // This request was just summarized, so it is not warned that a summary is coming.
  expect(texts.at(-1)).not.toContain('summarized soon');
  expect(texts).toContain('QUESTION-NOW');
  expect(texts.some((text) => text.includes('<history_file>'))).toBe(true);
});
