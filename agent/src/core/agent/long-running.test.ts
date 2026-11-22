import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
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
  const summary = new MockLanguageModelV4({ doGenerate: async ({ abortSignal }) => {
    await new Promise((resolve) => setTimeout(resolve, 8 * 60_000));
    abortSignal?.throwIfAborted();

    if (++calls < 5) return { content: [{ type: 'tool-call' as const, toolCallId: `ls-${calls}`, toolName: 'context_grep', input: JSON.stringify({ pattern: 'migration' }) }],
      finishReason: { unified: 'tool-calls' as const, raw: undefined }, usage, warnings: [] };

    return text('migration: clean');
  } });

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
