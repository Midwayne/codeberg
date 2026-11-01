import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { ToolLoopAgent } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { SearchRuns } from './manager.js';
import { WebSessionStore } from '../sessions/store.js';
import { defaultChatGenerator } from '../usage/generate.js';
import { UsageStore } from '../usage/store.js';

it('stops a live SDK text stream and saves partial output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codeberg-stream-stop-'));
  let signal: AbortSignal | undefined;
  const model = new MockLanguageModelV4({ doStream: async (options) => {
    signal = options.abortSignal;

    return { stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: 'text-start', id: 'text' });
      controller.enqueue({ type: 'text-delta', id: 'text', delta: 'Partial answer' });
    } }) };
  } });
  const sessions = new WebSessionStore(directory);
  const generate = defaultChatGenerator({ title: 'test', agent: new ToolLoopAgent({ model }) },
    new UsageStore(join(directory, 'usage')));
  const runs = new SearchRuns(sessions, generate);
  const run = await runs.admit({ chatId: 'chat', requestId: 'request',
    messages: [{ id: 'user', role: 'user', parts: [{ type: 'text', text: 'Explain auth' }] }] });

  try {
    await vi.waitFor(() => expect(run.events).toContainEqual(expect.objectContaining({ type: 'text-delta' })));
    const stopped = vi.fn();
    const stopping = runs.stop('chat', run.record.id).then(stopped);

    await vi.waitFor(() => expect(stopped).toHaveBeenCalledOnce(), { timeout: 500 });
    await stopping;
    expect(signal?.aborted).toBe(true);
    expect(run.record.status).toBe('stopped');
    expect((await sessions.load('chat'))?.messages.at(-1)?.parts).toContainEqual({
      type: 'text', text: 'Partial answer', state: 'done',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
