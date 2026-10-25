import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { UIMessage, UIMessageChunk } from 'ai';
import { expect, it, vi } from 'vitest';

import { createWebServer } from '../server.js';
import { WebSessionStore } from '../sessions/store.js';
import type { ChatGenerator } from './types.js';

it('allows follow-ups after reasoning with an idle second tab and preserves canonical history', async () => {
  const workspacePath = '../../../web-ui/src/sessions/workspace-chat.js';
  const transportPath = '../../../web-ui/src/sessions/run-transport.js';
  const { createWorkspaceChat } = await import(workspacePath);
  const { RunTransport } = await import(transportPath);
  const directory = await mkdtemp(join(tmpdir(), 'codeberg-history-sync-'));
  const sessions = new WebSessionStore(directory);
  let answers = 0;
  const generate = vi.fn<ChatGenerator>(async () => ({ stream: answerStream(++answers) }));
  const server = createWebServer({ title: 'test', sessionStore: sessions, generate });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api: typeof fetch = (url, options) => fetch(new URL(String(url), base), options);
  const persist = async (record: { id: string; messages: UIMessage[] }) => {
    const response = await api(`/api/sessions/${record.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record),
    });
    expect(response.ok).toBe(true);
  };
  const createTab = (messages: UIMessage[]) => createWorkspaceChat({ id: 'chat', messages,
    transport: new RunTransport(api), serverOwned: true, persist });
  const first = createTab([]);
  let second: ReturnType<typeof createTab> | undefined;

  try {
    await first.chat.sendMessage({ text: 'Find auth' });
    expect(first.chat.status).toBe('ready');
    const saved = (await sessions.load('chat'))!;
    second = createTab(saved.messages);
    await second.chat.resumeStream();
    expect(generate).toHaveBeenCalledOnce();

    await first.chat.sendMessage({ text: 'What calls it?' });

    expect(first.chat.error).toBeUndefined();
    expect(first.chat.status).toBe('ready');
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1]![0].messages.slice(0, saved.messages.length)).toEqual(saved.messages);
    const completed = (await sessions.load('chat'))!;
    expect(completed.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);

    // A stale tab saving its old snapshot cannot replace the newer server answer.
    await persist({ id: 'chat', messages: second.chat.messages });
    expect((await sessions.load('chat'))?.messages).toEqual(completed.messages);
    await second.chat.sendMessage({ text: 'Stale follow-up' });
    expect(second.chat.error?.message).toContain('Chat history changed');
    expect(generate).toHaveBeenCalledTimes(2);

    await first.chat.regenerate();

    expect(first.chat.error).toBeUndefined();
    expect(first.chat.status).toBe('ready');
    expect(generate).toHaveBeenCalledTimes(3);
    expect(generate.mock.calls[2]![0].messages).toEqual(completed.messages.slice(0, -1));
    expect((await sessions.load('chat'))?.messages).toHaveLength(4);
  } finally {
    await first.dispose();
    await second?.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

function answerStream(turn: number) {
  const chunks: UIMessageChunk[] = [
    { type: 'start', messageId: `answer-${turn}` },
    { type: 'start-step' },
    { type: 'reasoning-start', id: 'reasoning' },
    { type: 'reasoning-delta', id: 'reasoning', delta: 'Checking callers' },
    { type: 'reasoning-end', id: 'reasoning' },
    { type: 'tool-input-start', toolCallId: 'tool', toolName: 'grep' },
    { type: 'tool-input-available', toolCallId: 'tool', toolName: 'grep', input: { pattern: 'auth' } },
    { type: 'tool-output-available', toolCallId: 'tool', output: { path: 'auth.ts' } },
    { type: 'finish-step' },
    { type: 'start-step' },
    { type: 'text-start', id: 'text' },
    { type: 'text-delta', id: 'text', delta: `Answer ${turn}` },
    { type: 'text-end', id: 'text' },
    { type: 'finish-step' },
    { type: 'finish' },
  ];

  return new ReadableStream<UIMessageChunk>({ start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk);

    controller.close();
  } });
}
