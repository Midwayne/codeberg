import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
import { expect, it, vi } from 'vitest';

import { Agent } from '../agent.js';
import { DaemonClient } from '../client.js';
import { ContextStore } from '../context/store.js';
import { webConfigFromEnv } from '../web/config.js';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }],
  finishReason: { unified: 'stop' as const, raw: undefined }, usage, warnings: [] });

async function agentWith(env: Record<string, string>, extra: Partial<ConstructorParameters<typeof Agent>[0]> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'codeberg-subagents-'));
  const daemon = new DaemonClient('http://unused.test');
  vi.spyOn(daemon, 'listTools').mockResolvedValue([]);

  let step = 0;
  const chat = new MockLanguageModelV4({ doGenerate: async () => {
    step++;
    if (step > 1) return text('All services are healthy.');

    return { content: [{ type: 'tool-call' as const, toolCallId: 'fan', toolName: 'run_subagents',
      input: JSON.stringify({ tasks: [{ description: 'Check checkout', prompt: 'Check checkout health' }] }) }],
    finishReason: { unified: 'tool-calls' as const, raw: undefined }, usage, warnings: [] };
  } });
  const summary = new MockLanguageModelV4({ doGenerate: async () => text('checkout: healthy, p99 120ms') });

  const agent = new Agent({ model: chat, summaryModel: summary, daemon, decisionModel: null, learning: false,
    promptHooks: [], env: { CODEBERG_HOME: directory, ...env }, context: ContextStore.open(join(directory, 'context')),
    mcp: { enabled: false, servers: [], files: [], warnings: [] }, web: webConfigFromEnv({ CODEBERG_WEB_USE: 'false' }),
    ...extra });

  return { agent, chat, summary };
}

it('runs subagents on the summary model and feeds their reports back to the chat model', async () => {
  const { agent, chat, summary } = await agentWith({});

  try {
    const result = await agent.ask('Check all services');

    expect(result.answer).toContain('All services are healthy.');
    expect(summary.doGenerateCalls).toHaveLength(1);
    expect(JSON.stringify(chat.doGenerateCalls[1]!.prompt)).toContain('checkout: healthy, p99 120ms');
  } finally {
    await agent.close();
  }
});

it('offers no run_subagents tool when CODEBERG_SUBAGENTS_USE is off', async () => {
  const { agent, chat } = await agentWith({ CODEBERG_SUBAGENTS_USE: 'false' });

  try {
    await agent.ask('Check all services').catch(() => undefined);
    const names = (chat.doGenerateCalls[0]!.tools ?? []).map((entry) => entry.name);

    expect(names).not.toContain('run_subagents');
    expect(names.length).toBeGreaterThan(0);
  } finally {
    await agent.close();
  }
});

it('runs subagents on their own model when one is chosen in Models', async () => {
  const own = new MockLanguageModelV4({ doGenerate: async () => text('checkout: healthy, p99 120ms') });
  const { agent, summary } = await agentWith({}, { subagents: { enabled: true, model: own } });

  try {
    await agent.ask('Check all services');

    expect(own.doGenerateCalls).toHaveLength(1);
    expect(summary.doGenerateCalls).toHaveLength(0);
  } finally {
    await agent.close();
  }
});

it('lets the Models switch turn subagents off even when the environment allows them', async () => {
  const { agent, chat } = await agentWith({}, { subagents: { enabled: false } });

  try {
    await agent.ask('Check all services').catch(() => undefined);

    expect((chat.doGenerateCalls[0]!.tools ?? []).map((entry) => entry.name)).not.toContain('run_subagents');
  } finally {
    await agent.close();
  }
});
