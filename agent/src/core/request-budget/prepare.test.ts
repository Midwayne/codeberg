import type { LanguageModelV4CallOptions, LanguageModelV4Message } from '@ai-sdk/provider';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ContextStore } from '../context/store.js';
import { RequestCheckpoints } from './checkpoints.js';
import { compactRequest } from './compact.js';
import { prepareRequest } from './prepare.js';
import { RequestUsage } from './usage.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const small = { provider: 'test', modelId: 'test', contextWindow: 12_000, cache: 'none' as const };
const large = { ...small, contextWindow: 200_000 };
const big = (index: number) => `match ${index} `.repeat(200);

function setup(profile = small) {
  const root = mkdtempSync(join(tmpdir(), 'cberg-prepare-'));
  roots.push(root);

  const context = ContextStore.open(root);
  const options = { profile, context, summarize: vi.fn(async () => 'Earlier work') };

  return { context, options, checkpoints: new RequestCheckpoints(context, 'policy'), usage: new RequestUsage() };
}

function request(results: string[]): LanguageModelV4CallOptions {
  const steps = results.flatMap((value, index): LanguageModelV4Message[] => [
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: `c${index}`, toolName: 'grep', input: { index } }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: `c${index}`, toolName: 'grep', output: { type: 'text', value } }] },
  ]);

  return { prompt: [{ role: 'system', content: 'SYS' }, { role: 'user', content: [{ type: 'text', text: 'where?' }] }, ...steps] };
}

function results(call: LanguageModelV4CallOptions): string[] {
  return call.prompt.flatMap((message) => message.role === 'tool'
    ? message.content.flatMap((part) => part.type === 'tool-result' && part.output.type === 'text' ? [part.output.value] : [])
    : []);
}

function texts(call: LanguageModelV4CallOptions): string {
  return call.prompt.map((message) => JSON.stringify(message.content)).join('\n');
}

describe('prepareRequest', () => {
  it('clears old tool results once the full prompt passes half the compaction ceiling', async () => {
    const deps = setup();
    const outputs = Array.from({ length: 13 }, (_, index) => big(index));

    const { request: sent } = await prepareRequest(request(outputs), deps);

    expect(results(sent)[0]).toMatch(/^\[cleared grep result/);
    expect(results(sent).slice(8)).toEqual(outputs.slice(8));
  });

  it('sends short requests unchanged', async () => {
    const deps = setup(large);
    const input = request(Array.from({ length: 13 }, () => 'short'));

    expect((await prepareRequest(input, deps)).request.prompt).toEqual(input.prompt);
  });

  it('finds a summary saved for a cleared prompt on the next step', async () => {
    const deps = setup();
    const outputs = Array.from({ length: 14 }, (_, index) => big(index));

    const first = await prepareRequest(request(outputs.slice(0, 13)), deps);
    await compactRequest(first.request, 2_000, first.budget);
    expect(deps.options.summarize).toHaveBeenCalledTimes(1);

    const second = await prepareRequest(request(outputs), deps);

    expect(texts(second.request)).toContain('<conversation_summary>');
  });

  it('keeps results cleared when a restored summary hides older messages', async () => {
    const deps = setup();
    const outputs = Array.from({ length: 13 }, (_, index) => big(index));
    const input = request(outputs);

    const file = await deps.context.writeHistory('older work');
    const marker = { role: 'user' as const, content: [{ type: 'text' as const, text: `<conversation_summary>\nS\n</conversation_summary>\n<history_file>${file}</history_file>` }] };
    await deps.checkpoints.save(input, { count: 4, marker });

    const sent = (await prepareRequest(input, deps)).request;
    const remaining = results(sent);

    expect(texts(sent)).toContain('<conversation_summary>');
    expect(remaining).toHaveLength(12);
    for (const text of remaining.slice(0, 7)) expect(text).toMatch(/^\[cleared grep result/);
    expect(remaining.slice(7)).toEqual(outputs.slice(8));
  });
});
