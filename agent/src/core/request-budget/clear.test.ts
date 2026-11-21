import type { LanguageModelV4CallOptions, LanguageModelV4Message } from '@ai-sdk/provider';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ContextStore } from '../context/store.js';
import { spillPreview } from '../context/spill.js';
import { clearOldToolResults } from './clear.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function store(): ContextStore {
  const root = mkdtempSync(join(tmpdir(), 'cberg-clear-'));
  roots.push(root);

  return ContextStore.open(root);
}

function toolStep(index: number, text: string): LanguageModelV4Message[] {
  const toolCallId = `call-${index}`;

  return [
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId, toolName: 'grep', input: { pattern: `p${index}` } }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId, toolName: 'grep', output: { type: 'text', value: text } }] },
  ];
}

function request(results: string[]): LanguageModelV4CallOptions {
  return {
    prompt: [
      { role: 'system', content: 'SYS' },
      { role: 'user', content: [{ type: 'text', text: 'where is chunking?' }] },
      ...results.flatMap((text, index) => toolStep(index, text)),
    ],
  };
}

function resultTexts(call: LanguageModelV4CallOptions): string[] {
  return call.prompt.flatMap((message) => message.role === 'tool'
    ? message.content.flatMap((part) => part.type === 'tool-result' && part.output.type === 'text' ? [part.output.value] : [])
    : []);
}

const big = (index: number) => `match ${index} `.repeat(200);

describe('clearOldToolResults', () => {
  it('replaces older large results with a pointer to the saved full output', async () => {
    const context = store();
    const results = Array.from({ length: 13 }, (_, index) => big(index));

    const texts = resultTexts(await clearOldToolResults(request(results), context));

    for (const text of texts.slice(0, 8)) expect(text).toMatch(/^\[cleared grep result: \d+ chars, saved in /);
    expect(texts.slice(8)).toEqual(results.slice(8));

    const file = /saved in (.+?)\. /.exec(texts[0]!)![1]!;
    expect(readFileSync(file, 'utf8')).toBe(results[0]);
  });

  it('waits until a whole block of older results can be cleared', async () => {
    const results = Array.from({ length: 11 }, (_, index) => big(index));
    const input = request(results);

    expect(await clearOldToolResults(input, store())).toBe(input);
  });

  it('keeps small results and reuses the file behind a spilled preview', async () => {
    const context = store();
    const file = await context.writeToolOutput('grep', 'full spilled body');
    const preview = spillPreview(file, `${'x'.repeat(5_000)}`);
    const results = [preview, 'tiny', ...Array.from({ length: 11 }, (_, index) => big(index))];

    const texts = resultTexts(await clearOldToolResults(request(results), context));

    expect(texts[0]).toContain(`saved in ${file}.`);
    expect(texts[1]).toBe('tiny');
    expect(readdirSync(join(context.root, 'tools')).filter((name) => name.endsWith('.txt') && name !== 'INDEX.txt')).toHaveLength(7);
  });

  it('writes each cleared result to disk once across steps', async () => {
    const context = store();
    const write = vi.spyOn(context, 'writeToolOutput');
    const results = Array.from({ length: 13 }, (_, index) => `${big(index)} once`);

    await clearOldToolResults(request(results), context);
    await clearOldToolResults(request(results), context);

    expect(write).toHaveBeenCalledTimes(8);
  });

  it('writes a cleared result again when its file was removed', async () => {
    const context = store();
    const results = Array.from({ length: 13 }, (_, index) => `${big(index)} removed`);

    const first = resultTexts(await clearOldToolResults(request(results), context));
    const file = /saved in (.+?)\. /.exec(first[0]!)![1]!;
    rmSync(file);

    await clearOldToolResults(request(results), context);

    expect(readFileSync(file, 'utf8')).toBe(results[0]);
  });

  it('leaves the cleared prefix byte-identical as the conversation grows', async () => {
    const context = store();
    const results = Array.from({ length: 14 }, (_, index) => big(index));

    const first = await clearOldToolResults(request(results.slice(0, 13)), context);
    const second = await clearOldToolResults(request(results), context);

    expect(second.prompt.slice(0, first.prompt.length - 2)).toEqual(first.prompt.slice(0, first.prompt.length - 2));
  });
});
