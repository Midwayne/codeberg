import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';
import { MockLanguageModelV4 } from 'ai/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

import { ContextStore } from '../context/store.js';
import { manageContextModel } from './model.js';
import { RequestCheckpoints } from './checkpoints.js';

it('reuses provider checkpoints for later tool steps and after a model wrapper restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cberg-wire-checkpoint-'));

  try {
    const raw = new MockLanguageModelV4({ doGenerate: async () => ({
      content: [{ type: 'text', text: 'Done' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }) });
    const summarize = vi.fn(async () => 'Checkpoint');
    const options = {
      profile: { provider: 'test', modelId: 'test', contextWindow: 4096, cache: 'none' as const },
      context: ContextStore.open(root),
      summarize,
    };
    const request: LanguageModelV4CallOptions = { prompt: [
      { role: 'user', content: [{ type: 'text', text: 'old request' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'history '.repeat(2000) }] },
      { role: 'user', content: [{ type: 'text', text: 'current request' }] },
    ] };

    await manageContextModel(raw, options).doGenerate(request);
    request.prompt.push({ role: 'assistant', content: [{ type: 'text', text: 'Answer' }] });
    request.prompt.push({ role: 'user', content: [{ type: 'text', text: 'Follow up' }] });
    await manageContextModel(raw, options).doGenerate(request);

    expect(summarize).toHaveBeenCalledOnce();
    expect(raw.doGenerateCalls[1]?.prompt.at(-1)).toEqual(request.prompt.at(-1));
    expect(JSON.stringify(raw.doGenerateCalls[1]?.prompt)).not.toContain('history history');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('preserves the original attachment data while restoring a checkpoint inside a tool loop', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cberg-checkpoint-media-'));

  try {
    const context = ContextStore.open(root);
    const archive = await context.writeHistory('earlier tool step');
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const request: LanguageModelV4CallOptions = { prompt: [
      { role: 'system', content: 'Instructions' },
      { role: 'user', content: [{ type: 'file', mediaType: 'image/png', data: { type: 'data', data: bytes } }] },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'old', toolName: 'read', input: {} }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'old', toolName: 'read', output: { type: 'text', value: 'old' } }] },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'latest', toolName: 'read', input: {} }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'latest', toolName: 'read', output: { type: 'text', value: 'latest' } }] },
    ] };

    await new RequestCheckpoints(context, 'policy').save(request, {
      count: 4,
      preserveUser: 1,
      marker: { role: 'user', content: [{ type: 'text', text: `<history_file>${archive}</history_file>` }] },
    });
    const restored = await new RequestCheckpoints(context, 'policy').restore(request);

    expect(restored.prompt[2]).toBe(request.prompt[1]);
    expect(restored.prompt.slice(-2)).toEqual(request.prompt.slice(-2));
    expect(JSON.stringify(restored.prompt)).not.toContain('"toolCallId":"old"');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
