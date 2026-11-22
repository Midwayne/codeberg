import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
import { generateMock } from '../test-models.js';
import { afterEach, expect, it, vi } from 'vitest';

import { Agent } from '../agent.js';
import { DaemonClient } from '../client.js';
import { ContextStore } from '../context/store.js';
import { webConfigFromEnv } from '../web/config.js';

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }],
  finishReason: { unified: 'stop' as const, raw: undefined }, usage, warnings: [] });

afterEach(() => vi.useRealTimers());

it('lets a turn and its subagent run for as long as they keep working, with no wall-clock deadline', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const directory = await mkdtemp(join(tmpdir(), 'codeberg-long-running-'));
  const daemon = new DaemonClient('http://unused.test');
  vi.spyOn(daemon, 'listTools').mockResolvedValue([]);

  let step = 0;
  const chat = new MockLanguageModelV4({ doGenerate: async () => {
    if (++step > 1) return text('The migration check finished.');

    return { content: [{ type: 'tool-call' as const, toolCallId: 'fan', toolName: 'run_subagents',
      input: JSON.stringify({ tasks: [{ description: 'Slow check', prompt: 'Run the slow migration check' }] }) }],
    finishReason: { unified: 'tool-calls' as const, raw: undefined }, usage, warnings: [] };
  } });

  // Each subagent step answers within the request window, but the subagent works for 40 minutes in all.
  let calls = 0;
  const summary = generateMock(async ({ abortSignal }) => {
    await new Promise((resolve) => setTimeout(resolve, 8 * 60_000));
    abortSignal?.throwIfAborted();

    if (++calls < 5) return { content: [{ type: 'tool-call' as const, toolCallId: `ls-${calls}`, toolName: 'context_grep', input: JSON.stringify({ pattern: 'migration' }) }],
      finishReason: { unified: 'tool-calls' as const, raw: undefined }, usage, warnings: [] };

    return text('migration: clean');
  });

  const agent = new Agent({ model: chat, summaryModel: summary, daemon, decisionModel: null, learning: false, promptHooks: [],
    // A wide request window keeps real file I/O between fake ticks from looking like a stall.
    env: { CODEBERG_HOME: directory, CODEBERG_MODEL_REQUEST_TIMEOUT_MS: '3600000' }, context: ContextStore.open(join(directory, 'context')),
    mcp: { enabled: false, servers: [], files: [], warnings: [] }, web: webConfigFromEnv({ CODEBERG_WEB_USE: 'false' }) });

  try {
    let settled = false;
    const answer = agent.ask('Check the migration').finally(() => {
      settled = true;
    });

    // Advance the clock a minute at a time, letting real file I/O run in between.
    while (!settled) {
      await vi.advanceTimersByTimeAsync(60_000);
      await new Promise((resolve) => setImmediate(resolve));
    }

    const result = await answer;

    expect(calls).toBe(5);
    expect(result.answer).toContain('finished');
    expect(JSON.stringify(chat.doGenerateCalls[1]!.prompt)).toContain('migration: clean');
  } finally {
    vi.useRealTimers();
    await agent.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

it('lets one subagent step stream for longer than the request window while output keeps arriving', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const directory = await mkdtemp(join(tmpdir(), 'codeberg-long-step-'));
  const daemon = new DaemonClient('http://unused.test');
  vi.spyOn(daemon, 'listTools').mockResolvedValue([]);

  let step = 0;
  const chat = generateMock(async () => {
    if (++step > 1) return text('Done.');

    return { content: [{ type: 'tool-call' as const, toolCallId: 'fan', toolName: 'run_subagents',
      input: JSON.stringify({ tasks: [{ description: 'Deep check', prompt: 'Think hard about the migration' }] }) }],
    finishReason: { unified: 'tool-calls' as const, raw: undefined }, usage, warnings: [] };
  });

  // One subagent step that reasons for 15 minutes, emitting a chunk every minute.
  const thinker = new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({ async start(controller) {
    controller.enqueue({ type: 'stream-start', warnings: [] });
    controller.enqueue({ type: 'text-start', id: 't' });
    for (let minute = 0; minute < 15; minute++) {
      await new Promise((resolve) => setTimeout(resolve, 60_000));
      controller.enqueue({ type: 'text-delta', id: 't', delta: minute === 14 ? 'migration: clean' : '' });
    }
    controller.enqueue({ type: 'text-end', id: 't' });
    controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage });
    controller.close();
  } }) }) });

  const agent = new Agent({ model: chat, summaryModel: thinker, daemon, decisionModel: null, learning: false, promptHooks: [],
    env: { CODEBERG_HOME: directory }, context: ContextStore.open(join(directory, 'context')),
    mcp: { enabled: false, servers: [], files: [], warnings: [] }, web: webConfigFromEnv({ CODEBERG_WEB_USE: 'false' }) });

  try {
    let settled = false;
    const answer = agent.ask('Check the migration').finally(() => {
      settled = true;
    });

    while (!settled) {
      await vi.advanceTimersByTimeAsync(10_000);
      await new Promise((resolve) => setImmediate(resolve));
    }

    await answer;

    expect(thinker.doStreamCalls).toHaveLength(1);
    expect(JSON.stringify(chat.doGenerateCalls[1]!.prompt)).toContain('migration: clean');
  } finally {
    vi.useRealTimers();
    await agent.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

it('ends a turn with an answer, not a tool call, when CODEBERG_MAX_TURN_STEPS is set', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codeberg-turn-budget-'));
  const daemon = new DaemonClient('http://unused.test');
  vi.spyOn(daemon, 'listTools').mockResolvedValue([]);

  // A model stuck re-calling a tool; it answers only when tools are taken away.
  const chat = generateMock(async ({ toolChoice }) => toolChoice?.type === 'none'
    ? text('Stopped at the step budget: the context search kept finding nothing new.')
    : { content: [{ type: 'tool-call' as const, toolCallId: `c-${Math.random()}`, toolName: 'context_grep', input: JSON.stringify({ pattern: 'x' }) }],
      finishReason: { unified: 'tool-calls' as const, raw: undefined }, usage, warnings: [] });

  const agent = new Agent({ model: chat, daemon, decisionModel: null, learning: false, promptHooks: [],
    env: { CODEBERG_HOME: directory, CODEBERG_MAX_TURN_STEPS: '4' }, context: ContextStore.open(join(directory, 'context')),
    mcp: { enabled: false, servers: [], files: [], warnings: [] }, web: webConfigFromEnv({ CODEBERG_WEB_USE: 'false' }) });

  try {
    const result = await agent.ask('Find x');

    expect(chat.doGenerateCalls).toHaveLength(4);
    expect(result.answer).toContain('step budget');
  } finally {
    await agent.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('stops a hung tool call in a turn after CODEBERG_TOOL_TIMEOUT_MS and lets the agent continue', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codeberg-tool-timeout-'));
  const daemon = new DaemonClient('http://unused.test');
  vi.spyOn(daemon, 'listTools').mockResolvedValue([{ name: 'read_file', description: 'read', schema: { type: 'object' } }] as never);
  vi.spyOn(daemon, 'callTool').mockImplementation(() => new Promise(() => undefined));

  let step = 0;
  const chat = generateMock(async () => ++step === 1
    ? { content: [{ type: 'tool-call' as const, toolCallId: 'read', toolName: 'read_file', input: JSON.stringify({ path: 'a.ts' }) }],
      finishReason: { unified: 'tool-calls' as const, raw: undefined }, usage, warnings: [] }
    : text('The daemon did not answer; try again later.'));

  const agent = new Agent({ model: chat, daemon, decisionModel: null, learning: false, promptHooks: [],
    env: { CODEBERG_HOME: directory, CODEBERG_TOOL_TIMEOUT_MS: '200' }, context: ContextStore.open(join(directory, 'context')),
    mcp: { enabled: false, servers: [], files: [], warnings: [] }, web: webConfigFromEnv({ CODEBERG_WEB_USE: 'false' }) });

  try {
    const result = await agent.ask('Read a.ts');

    expect(result.answer).toContain('did not answer');
    expect(JSON.stringify(chat.doGenerateCalls[1]!.prompt)).toContain('read_file did not finish within 200 ms');
  } finally {
    await agent.close();
    await rm(directory, { recursive: true, force: true });
  }
});
