import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import { createWebServer } from '../server.js';
import { WebSessionStore } from '../sessions/store.js';
import type { ChatGenerator } from './types.js';

it.each(['offline', 'storage failure'])('retries an unadmitted follow-up after a completed turn: %s', async (failure) => {
  const workspacePath = '../../../web-ui/src/sessions/workspace-chat.js';
  const transportPath = '../../../web-ui/src/sessions/run-transport.js';
  const { createWorkspaceChat } = await import(workspacePath);
  const { RunTransport } = await import(transportPath);
  const directory = await mkdtemp(join(tmpdir(), 'codeberg-follow-up-retry-'));
  const sessions = new WebSessionStore(directory);
  const generate = vi.fn<ChatGenerator>(async () => ({ stream: new ReadableStream({ start(controller) {
    controller.enqueue({ type: 'start', messageId: `answer-${generate.mock.calls.length}` });
    controller.enqueue({ type: 'text-start', id: 'text' });
    controller.enqueue({ type: 'text-delta', id: 'text', delta: 'Found auth.ts' });
    controller.enqueue({ type: 'text-end', id: 'text' });
    controller.enqueue({ type: 'finish' });
    controller.close();
  } }) }));
  const server = createWebServer({ title: 'test', sessionStore: sessions, generate });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let offline = false;
  const bodies: Record<string, any>[] = [];
  const api: typeof fetch = async (url, options) => {
    if (options?.method === 'POST') bodies.push(JSON.parse(String(options.body)));
    if (offline) throw new TypeError('offline');

    return fetch(new URL(String(url), base), options);
  };
  const transport = new RunTransport(api, () => Promise.resolve());
  const workspace = createWorkspaceChat({ id: 'chat', messages: [], transport, serverOwned: true, persist: async () => {} });
  let writeFailure: ReturnType<typeof vi.spyOn> | undefined;

  try {
    await workspace.chat.sendMessage({ text: 'Find auth' });
    expect(workspace.chat.status).toBe('ready');
    offline = failure === 'offline';
    if (!offline) writeFailure = vi.spyOn(sessions, 'upsert').mockRejectedValueOnce(new Error('disk unavailable'));

    await workspace.chat.sendMessage({ text: 'What calls it?' });
    expect(workspace.chat.status).toBe('error');
    expect(generate).toHaveBeenCalledOnce();
    const pending = bodies[1];
    offline = false;

    await transport.retry(workspace.chat);

    expect(workspace.chat.status).toBe('ready');
    expect(generate).toHaveBeenCalledTimes(2);
    expect(bodies.at(-1)).toEqual(pending);
    expect(workspace.chat.messages.map((message: any) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect((await sessions.load('chat'))?.messages).toEqual(workspace.chat.messages);
  } finally {
    writeFailure?.mockRestore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
