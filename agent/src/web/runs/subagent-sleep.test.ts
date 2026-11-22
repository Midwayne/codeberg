import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';

import { Agent } from '../../core/agent.js';
import { DaemonClient } from '../../core/client.js';
import { ContextStore } from '../../core/context/store.js';
import { webConfigFromEnv } from '../../core/web/config.js';
import { createWebServer } from '../server.js';
import { WebSessionStore } from '../sessions/store.js';

const usage = { inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };

type Call = { id: string; name: string; input: unknown };

function streamOf(calls: Call[], text?: string) {
  return { stream: new ReadableStream({ start(controller) {
    for (const call of calls) controller.enqueue({ type: 'tool-call', toolCallId: call.id, toolName: call.name, input: JSON.stringify(call.input) });
    if (text) {
      controller.enqueue({ type: 'text-start', id: 't' });
      controller.enqueue({ type: 'text-delta', id: 't', delta: text });
      controller.enqueue({ type: 'text-end', id: 't' });
    }
    controller.enqueue({ type: 'finish', finishReason: { unified: calls.length ? 'tool-calls' : 'stop', raw: undefined }, usage });
    controller.close();
  } }) };
}

const tasks = [{ description: 'Check checkout', prompt: 'Check checkout health' }];

async function harness(script: (prompt: string, step: number) => ReturnType<typeof streamOf>) {
  const directory = await mkdtemp(join(tmpdir(), 'codeberg-subagent-sleep-'));
  const daemon = new DaemonClient('http://unused.test');
  vi.spyOn(daemon, 'listTools').mockResolvedValue([]);
  let step = 0;
  const chat = new MockLanguageModelV4({ doStream: async ({ prompt }) => script(JSON.stringify(prompt), step++) });
  const summary = new MockLanguageModelV4({ doGenerate: async () => (await new Promise((resolve) => setTimeout(resolve, 1000)), { content: [{ type: 'text' as const, text: 'checkout: healthy' }],
    finishReason: { unified: 'stop' as const, raw: undefined }, usage, warnings: [] }) });
  const agent = new Agent({ model: chat, summaryModel: summary, daemon, decisionModel: null, learning: false, promptHooks: [],
    env: { CODEBERG_HOME: directory }, context: ContextStore.open(join(directory, 'context')),
    mcp: { enabled: false, servers: [], files: [], warnings: [] }, web: webConfigFromEnv({ CODEBERG_WEB_USE: 'false' }) });
  const sessions = new WebSessionStore(join(directory, 'sessions'));
  const server = createWebServer({ title: 'test', sessionStore: sessions, agent: await agent.toolLoopAgent() });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api: typeof fetch = (url, options) => fetch(new URL(String(url), base), options);
  const { createWorkspaceChat } = await import('../../../web-ui/src/sessions/workspace-chat.js' as string);
  const { RunTransport } = await import('../../../web-ui/src/sessions/run-transport.js' as string);
  const browser = createWorkspaceChat({ id: 'chat', messages: [], transport: new RunTransport(api, () => Promise.resolve()), serverOwned: true, persist: async () => {} });
  const close = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await agent.close();
    await rm(directory, { recursive: true, force: true });
  };

  return { browser, sessions, api, close, summary };
}

type Part = { type: string; state?: string; text?: string; output?: { id?: string } };

const parts = (messages: Array<{ parts: Part[] }>) => messages.flatMap((message) => message.parts);

const tool = (messages: Array<{ parts: Part[] }>, type: string) => parts(messages).find((part) => part.type === type);

it('follows a detached subagent run through sleep, an early wake, and the subagents of the wake-up turn', async () => {
  const h = await harness((prompt, step) => {
    if (step === 0) return streamOf([{ id: 'start', name: 'start_background_tool', input: { tool: 'run_subagents', args: { tasks } } }]);

    if (step === 1) {
      const id = /[^A-Za-z]id\W+([0-9a-f]{32})/.exec(prompt)?.[1];

      return streamOf([{ id: 'sleep', name: 'sleep_agent', input: { prompt: 'Read reports', delay_seconds: 3600, job_ids: [id] } }]);
    }

    if (step === 2) return streamOf([{ id: 'fan', name: 'run_subagents', input: { tasks: [{ description: 'Recheck', prompt: 'Recheck checkout' }] } }]);

    return streamOf([], 'all good');
  });
  const { ScheduledChatUpdates } = await import('../../../web-ui/src/sessions/scheduled-chat-updates.js' as string);
  const updates = new ScheduledChatUpdates(new Map([['chat', h.browser]]), h.api);

  try {
    await h.browser.chat.sendMessage({ text: 'Check services' });

    const start = tool(h.browser.chat.messages, 'tool-start_background_tool');
    expect(tool(h.browser.chat.messages, 'tool-sleep_agent')?.state).toBe('output-available');

    const live = await (await h.api(`/api/schedules/${start?.output?.id}/subagents?chat=chat`)).json();
    expect(live).toMatchObject({ status: 'running', results: [{ description: 'Check checkout' }] });

    // The wake-up is an hour away; it runs once the subagents finish, and the browser follows it.
    await vi.waitFor(async () => {
      await updates.refresh(await (await h.api('/api/schedules')).json());
      expect(parts(h.browser.chat.messages).some((part) => part.text === 'all good')).toBe(true);
    }, { timeout: 15_000, interval: 300 });

    const done = await (await h.api(`/api/schedules/${start?.output?.id}/subagents?chat=chat`)).json();
    expect(done).toMatchObject({ status: 'completed', results: [{ status: 'completed', report: 'checkout: healthy' }] });
    expect(tool(h.browser.chat.messages, 'tool-run_subagents')?.state).toBe('output-available');

    // The browser sees the last text before the server finishes saving the turn.
    await vi.waitFor(async () => {
      expect(h.browser.chat.status).toBe('ready');
      expect((await h.sessions.load('chat'))!.messages).toEqual(h.browser.chat.messages);
    }, { timeout: 5_000, interval: 100 });
  } finally {
    updates.close();
    await h.close();
  }
}, 30_000);
