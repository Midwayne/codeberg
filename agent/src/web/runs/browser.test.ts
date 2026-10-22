import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import { ToolLoopAgent, jsonSchema, tool } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { createWebServer } from '../server.js';
import { WebSessionStore } from '../sessions/store.js';
import { recordToolExecutions } from '../../core/runs/tools.js';

it('keeps browser/server transcripts consistent through real SDK tool streams and follow-ups', async () => {
  // Exercise the browser package at runtime without importing it into the agent's build root.
  const workspacePath = '../../../web-ui/src/sessions/workspace-chat.js';
  const transportPath = '../../../web-ui/src/sessions/run-transport.js';
  const { createWorkspaceChat } = await import(workspacePath);
  const { RunTransport } = await import(transportPath);
  const directory = await mkdtemp(join(tmpdir(), 'codeberg-browser-run-'));
  const sessions = new WebSessionStore(directory);
  let step = 0;
  const execute = vi.fn(async () => ({ path: 'src/auth.ts', body: 'function authenticate() {}' }));
  const model = new MockLanguageModelV4({ doStream: async () => {
    const call = step++ % 2 === 0;
    return { stream: new ReadableStream({ start(controller) {
      if (call) controller.enqueue({ type: 'tool-call', toolCallId: `tool-${step}`, toolName: 'get_chunk', input: '{}' });
      else {
        controller.enqueue({ type: 'text-start', id: 'text' });
        controller.enqueue({ type: 'text-delta', id: 'text', delta: 'See src/auth.ts authenticate().' });
        controller.enqueue({ type: 'text-end', id: 'text' });
      }
      controller.enqueue({ type: 'finish', finishReason: { unified: call ? 'tool-calls' : 'stop', raw: undefined },
        usage: { inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 5, text: 5, reasoning: 0 } } });
      controller.close();
    } }) };
  } });
  const tools = recordToolExecutions({ get_chunk: tool({ inputSchema: jsonSchema({ type: 'object', properties: {} }), execute }) });
  const server = createWebServer({ title: 'test', sessionStore: sessions, agent: new ToolLoopAgent({ model, tools }) });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api: typeof fetch = (url, options) => fetch(new URL(String(url), base), options);
  const transport = new RunTransport(api, () => Promise.resolve());
  const chat = createWorkspaceChat({ id: 'chat', messages: [], transport, serverOwned: true,
    persist: async () => {} });
  try {
    await chat.chat.sendMessage({ text: 'Find auth' });
    expect(chat.chat.status).toBe('ready');
    expect((await sessions.load('chat'))?.messages).toEqual(chat.chat.messages);
    await chat.chat.sendMessage({ text: 'What calls it?' });
    expect(chat.chat.status).toBe('ready');
    expect(execute).toHaveBeenCalledTimes(2);
    expect((await sessions.load('chat'))?.messages).toEqual(chat.chat.messages);
    const run = await (await api('/api/chat/chat/run')).json();
    expect(run.tools.map((entry: any) => entry.state)).toEqual(['started', 'completed']);
    // A fresh browser can replay the persisted run without generating or duplicating an assistant message.
    const fresh = createWorkspaceChat({ id: 'chat', messages: (await sessions.load('chat'))!.messages,
      transport: new RunTransport(api), serverOwned: true, persist: async () => {} });
    await fresh.chat.resumeStream();
    expect(fresh.chat.messages).toEqual(chat.chat.messages);
    expect(execute).toHaveBeenCalledTimes(2);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

it('can ask a follow-up after explicitly stopping a search with an in-flight tool', async () => {
  const workspacePath = '../../../web-ui/src/sessions/workspace-chat.js';
  const transportPath = '../../../web-ui/src/sessions/run-transport.js';
  const { createWorkspaceChat } = await import(workspacePath);
  const { RunTransport } = await import(transportPath);
  const directory = await mkdtemp(join(tmpdir(), 'codeberg-stopped-browser-'));
  const sessions = new WebSessionStore(directory);
  let calls = 0;
  let toolStarted = false;
  const model = new MockLanguageModelV4({ doStream: async () => {
    const useTool = calls++ === 0;
    return { stream: new ReadableStream({ start(controller) {
      if (useTool) controller.enqueue({ type: 'tool-call', toolCallId: 'pending', toolName: 'get_chunk', input: '{}' });
      else {
        controller.enqueue({ type: 'text-start', id: 'text' });
        controller.enqueue({ type: 'text-delta', id: 'text', delta: 'Follow-up answer' });
        controller.enqueue({ type: 'text-end', id: 'text' });
      }
      controller.enqueue({ type: 'finish', finishReason: { unified: useTool ? 'tool-calls' : 'stop', raw: undefined },
        usage: { inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 5, text: 5, reasoning: 0 } } });
      controller.close();
    } }) };
  } });
  const tools = recordToolExecutions({ get_chunk: tool({ inputSchema: jsonSchema({ type: 'object', properties: {} }),
    execute: async (_input, options) => {
      toolStarted = true;
      await new Promise((_resolve, reject) => options.abortSignal?.addEventListener('abort', () => reject(new Error('stopped'))));
      return 'unreachable';
    },
  }) });
  const server = createWebServer({ title: 'test', sessionStore: sessions, agent: new ToolLoopAgent({ model, tools }) });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api: typeof fetch = (url, options) => fetch(new URL(String(url), base), options);
  const chat = createWorkspaceChat({ id: 'chat', messages: [], transport: new RunTransport(api),
    serverOwned: true, persist: async () => {} });
  try {
    chat.turns.submit({ text: 'Find auth' });
    await vi.waitFor(() => expect(toolStarted).toBe(true));
    await chat.turns.stop();
    expect(chat.chat.status).toBe('ready');
    expect((await sessions.load('chat'))?.messages).toEqual(chat.chat.messages);
    await chat.chat.sendMessage({ text: 'Try another route' });
    expect(chat.chat.status).toBe('ready');
    expect((await sessions.load('chat'))?.messages).toEqual(chat.chat.messages);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
