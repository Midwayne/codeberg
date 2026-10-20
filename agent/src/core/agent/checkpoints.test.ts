import type { ModelMessage } from 'ai';
import { mkdtempSync, rmSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

import { Agent } from '../agent.js';
import { DaemonClient, DEFAULT_DAEMON_URL } from '../client.js';
import { ContextStore } from '../context/store.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(root = mkdtempSync(join(tmpdir(), 'cberg-checkpoint-')), modelId = 'test') {
  roots.push(root);

  const generate = vi.fn(async () => 'SUMMARY');
  const agent = new Agent({
    model: {} as never,
    daemon: new DaemonClient(DEFAULT_DAEMON_URL),
    learning: false,
    generator: { generate },
    profile: { provider: 'test', modelId, contextWindow: 2000, cache: 'none' },
    context: ContextStore.open(root),
  });
  const messages: ModelMessage[] = Array.from({ length: 40 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: 'x'.repeat(600),
  }));

  return { agent, generate, messages, root };
}

it('reuses a checkpoint for the same prefix with new messages after an agent restart', async () => {
  const first = fixture();
  const initial = await first.agent.compactHistory(first.messages);
  const next = fixture(first.root);
  const messages: ModelMessage[] = [...first.messages, { role: 'user', content: 'follow up' }];
  const resumed = await next.agent.compactHistory(messages);

  expect(first.generate).toHaveBeenCalledOnce();
  expect(next.generate).not.toHaveBeenCalled();
  expect(resumed[0]).toEqual(initial[0]);
  expect(resumed.at(-1)).toEqual(messages.at(-1));
});

it('invalidates a checkpoint when an earlier message or model changes', async () => {
  const first = fixture();
  await first.agent.compactHistory(first.messages);

  const edited = [...first.messages];
  edited[0] = { role: 'user', content: 'changed requirement' };
  await first.agent.compactHistory(edited);

  expect(first.generate).toHaveBeenCalledTimes(2);

  const differentModel = fixture(first.root, 'other');
  await differentModel.agent.compactHistory(first.messages);

  expect(differentModel.generate).toHaveBeenCalledOnce();
});

it('coalesces simultaneous requests for the same checkpoint', async () => {
  const { agent, messages, generate } = fixture();
  const [first, second] = await Promise.all([
    agent.compactHistory(messages),
    agent.compactHistory(messages),
  ]);

  expect(first).toEqual(second);
  expect(generate).toHaveBeenCalledOnce();
});

it('regenerates a corrupt checkpoint without failing the chat', async () => {
  const first = fixture();
  await first.agent.compactHistory(first.messages);

  const directory = join(first.root, 'checkpoints');
  for (const folder of await readdir(directory)) {
    for (const file of await readdir(join(directory, folder))) {
      await writeFile(join(directory, folder, file), '{broken');
    }
  }

  const next = fixture(first.root);
  await next.agent.compactHistory(first.messages);

  expect(next.generate).toHaveBeenCalledOnce();
});
