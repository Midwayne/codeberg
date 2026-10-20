import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

import { DaemonClient, DEFAULT_DAEMON_URL } from '../client.js';
import { ContextStore } from '../context/store.js';
import { estimateTokens } from '../history.js';
import type { Prompt } from '../types.js';
import { summarize } from './history.js';
import { AgentState } from './state.js';

it('fits the complete summary request to a separately configured small model', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cberg-summary-window-'));

  try {
    const generate = vi.fn(async (_prompt: Prompt) => 'SUMMARY');
    const state = new AgentState({
      model: {} as never,
      daemon: new DaemonClient(DEFAULT_DAEMON_URL),
      learning: false,
      profile: { provider: 'test', modelId: 'chat', contextWindow: 200000, cache: 'none' },
      summaryProfile: { provider: 'test', modelId: 'summary', contextWindow: 2048, cache: 'none' },
      generator: { generate },
      context: ContextStore.open(root),
    });

    await summarize(state, `opening\n${'history'.repeat(20000)}\nending`);
    const request = generate.mock.calls[0]![0];

    expect(estimateTokens(request.prompt + request.system) + request.maxOutputTokens!).toBeLessThan(2048);
    expect(request.prompt).toContain('opening');
    expect(request.prompt).toContain('ending');
    expect(request.requireComplete).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('bounds summary overflow retries, reduces each request, and leaves other failures alone', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cberg-summary-retry-'));

  try {
    const overflow = Object.assign(new Error('prompt is too long'), { code: 'prompt_too_long' });
    const generate = vi.fn(async (_prompt: Prompt) => 'SUMMARY')
      .mockRejectedValueOnce(overflow)
      .mockRejectedValueOnce(overflow);
    const state = new AgentState({
      model: {} as never,
      daemon: new DaemonClient(DEFAULT_DAEMON_URL),
      learning: false,
      profile: { provider: 'test', modelId: 'chat', contextWindow: 4096, cache: 'none' },
      generator: { generate },
      context: ContextStore.open(root),
    });
    const transcript = 'history '.repeat(20000);

    expect(await summarize(state, transcript)).toBe('SUMMARY');
    expect(generate).toHaveBeenCalledTimes(3);
    expect(generate.mock.calls[2]![0].prompt.length).toBeLessThan(generate.mock.calls[0]![0].prompt.length);

    generate.mockReset().mockRejectedValue(overflow);
    await expect(summarize(state, transcript)).rejects.toThrow('prompt is too long');
    expect(generate).toHaveBeenCalledTimes(4);

    generate.mockReset().mockRejectedValue(new Error('invalid API key'));
    await expect(summarize(state, transcript)).rejects.toThrow('invalid API key');
    expect(generate).toHaveBeenCalledOnce();

    generate.mockReset();
    await expect(summarize(state, transcript, undefined, AbortSignal.abort())).rejects.toThrow();
    expect(generate).not.toHaveBeenCalled();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
