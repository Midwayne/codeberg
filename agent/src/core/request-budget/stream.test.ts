import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { MockLanguageModelV4 } from 'ai/test';
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

function fixture(replies: LanguageModelV4StreamPart[][]) {
  const root = mkdtempSync(join(tmpdir(), 'cberg-budget-stream-'));
  roots.push(root);

  const raw = new MockLanguageModelV4({
    doStream: async () => ({ stream: new ReadableStream({ start(controller) {
      for (const chunk of replies.shift()!) controller.enqueue(chunk);

      controller.close();
    } }) }),
  });
  const model = manageContextModel(raw, {
    profile: { provider: 'test', modelId: 'test', contextWindow: 8192, cache: 'none' },
    context: ContextStore.open(root),
    summarize: vi.fn(async () => 'Checkpoint'),
  });
  const request: LanguageModelV4CallOptions = { prompt: [
    { role: 'user', content: [{ type: 'text', text: 'Earlier question' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'history '.repeat(500) }] },
    { role: 'user', content: [{ type: 'text', text: 'Continue' }] },
  ] };

  return { model, raw, request };
}

async function drain(stream: ReadableStream<LanguageModelV4StreamPart>) {
  const reader = stream.getReader();
  const chunks: LanguageModelV4StreamPart[] = [];

  for (;;) {
    const next = await reader.read();
    if (next.done) return chunks;

    chunks.push(next.value);
  }
}

it('recovers from a stream context error before any generated output is exposed', async () => {
  const error = Object.assign(new Error('maximum context length exceeded'), { code: 'context_length_exceeded' });
  const { model, raw, request } = fixture([
    [{ type: 'stream-start', warnings: [] }, { type: 'error', error }],
    [{ type: 'text-start', id: 'text' }, { type: 'text-delta', id: 'text', delta: 'Recovered' }],
  ]);

  const result = await model.doStream(request);
  const chunks = await drain(result.stream);

  expect(raw.doStreamCalls).toHaveLength(2);
  expect(chunks).toEqual([
    { type: 'text-start', id: 'text' },
    { type: 'text-delta', id: 'text', delta: 'Recovered' },
  ]);
});

it('does not replay a stream after text or a tool-call stream has started', async () => {
  const error = Object.assign(new Error('maximum context length exceeded'), { code: 'context_length_exceeded' });
  const chunks: LanguageModelV4StreamPart[] = [
    { type: 'text-start', id: 'text' },
    { type: 'text-delta', id: 'text', delta: 'Already visible' },
    { type: 'error', error },
  ];
  const { model, raw, request } = fixture([chunks]);

  expect(await drain((await model.doStream(request)).stream)).toEqual(chunks);
  expect(raw.doStreamCalls).toHaveLength(1);
});
