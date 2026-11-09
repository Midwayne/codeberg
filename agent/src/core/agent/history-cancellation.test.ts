import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelMessage } from 'ai';
import { expect, it, vi } from 'vitest';
import { DaemonClient, DEFAULT_DAEMON_URL } from '../client.js';
import { ContextStore } from '../context/store.js';
import type { Prompt } from '../types.js';
import { historyCompactor } from './history.js';
import { createAgentState } from './state.js';

it('cancels history summarization and allows a fresh attempt with the same history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cberg-history-stop-'));
  const controller = new AbortController();
  let rejectSummary!: (error: Error) => void;
  const generate = vi.fn(async (prompt: Prompt) => new Promise<string>((_resolve, reject) => {
    rejectSummary = reject;
    prompt.abortSignal?.addEventListener('abort', () => reject(prompt.abortSignal?.reason), { once: true });
  }));
  const state = createAgentState({ model: {} as never, daemon: new DaemonClient(DEFAULT_DAEMON_URL), learning: false,
    profile: { provider: 'test', modelId: 'chat', contextWindow: 4096, cache: 'none' },
    generator: { generate }, context: ContextStore.open(root) });
  const messages: ModelMessage[] = [
    { role: 'user', content: 'old '.repeat(10000) },
    { role: 'assistant', content: 'old answer' },
    { role: 'user', content: 'Explain auth' },
  ];
  const compact = historyCompactor(state);
  const outcome = compact(messages, controller.signal).catch((error: unknown) => error);

  try {
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    controller.abort(new Error('Stopped during summary'));

    expect(generate.mock.calls[0]![0].abortSignal).toBe(controller.signal);
    expect(await outcome).toEqual(new Error('Stopped during summary'));
    generate.mockResolvedValue('Summary');
    expect(await compact(messages, new AbortController().signal)).toHaveLength(2);
    expect(generate).toHaveBeenCalledTimes(2);
  } finally {
    rejectSummary(new Error('Test cleanup'));
    await outcome;
    await rm(root, { recursive: true, force: true });
  }
});
