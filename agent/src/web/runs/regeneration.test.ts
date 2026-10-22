import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import { createWebServer } from '../server.js';
import { WebSessionStore } from '../sessions/store.js';
import type { ChatGenerator } from './types.js';

it('creates a new server run for explicit regeneration and saves its replacement answer', async () => {
  const workspacePath = '../../../web-ui/src/sessions/workspace-chat.js';
  const transportPath = '../../../web-ui/src/sessions/run-transport.js';
  const { createWorkspaceChat } = await import(workspacePath);
  const { RunTransport } = await import(transportPath);
  const directory = await mkdtemp(join(tmpdir(), 'codeberg-regeneration-'));
  const sessions = new WebSessionStore(directory);
  let answers = 0;
  const generate = vi.fn<ChatGenerator>(async () => ({ stream: new ReadableStream({ start(controller) {
    const id = `answer-${++answers}`;
    controller.enqueue({ type: 'start', messageId: id });
    controller.enqueue({ type: 'text-start', id: 'text' });
    controller.enqueue({ type: 'text-delta', id: 'text', delta: id });
    controller.enqueue({ type: 'text-end', id: 'text' });
    controller.enqueue({ type: 'finish' });
    controller.close();
  } }) }));
  const server = createWebServer({ title: 'test', sessionStore: sessions, generate });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api: typeof fetch = (url, options) => fetch(new URL(String(url), base), options);
  const workspace = createWorkspaceChat({ id: 'chat', messages: [], transport: new RunTransport(api),
    serverOwned: true, persist: async () => {} });

  try {
    await workspace.chat.sendMessage({ text: 'Find auth' });
    const prior = (await sessions.load('chat'))!;

    workspace.turns.regenerate();

    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(workspace.chat.status).toBe('ready'));
    const saved = (await sessions.load('chat'))!;
    expect(saved.serverRunId).not.toBe(prior.serverRunId);
    expect(saved.messages).toEqual(workspace.chat.messages);
    expect(saved.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(saved.messages[1]?.parts).toEqual([{ type: 'text', text: 'answer-2', state: 'done' }]);
    const status = await (await api('/api/chat/chat/run')).json();
    expect(status.status).toBe('completed');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
