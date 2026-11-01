import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
import { expect, it, vi } from 'vitest';
import { Agent } from '../agent.js';
import { DaemonClient } from '../client.js';
import { ContextStore } from '../context/store.js';
import { webConfigFromEnv } from '../web/config.js';
import { scheduleContext } from '../schedules/context.js';
import { backgroundContext } from './context.js';

it('stops the real agent loop after saving sleep and uses a fresh sleeping flag on its next turn', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codeberg-sleep-loop-'));
  const daemon = new DaemonClient('http://unused.test');
  vi.spyOn(daemon, 'listTools').mockResolvedValue([]);
  let step = 0;
  const model = new MockLanguageModelV4({ doGenerate: async () => {
    step++;
    const sleeping = step === 1;

    return {
      content: sleeping ? [{ type: 'tool-call', toolCallId: 'sleep', toolName: 'sleep_agent',
        input: JSON.stringify({ delay_seconds: 60, prompt: 'Check scan again' }) }]
        : [{ type: 'text', text: 'The scan finished.' }],
      finishReason: { unified: sleeping ? 'tool-calls' : 'stop', raw: undefined },
      usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 } }, warnings: [],
    };
  } });
  const agent = new Agent({ model, daemon, decisionModel: null, learning: false, promptHooks: [],
    env: { CODEBERG_HOME: directory }, context: ContextStore.open(join(directory, 'context')),
    mcp: { enabled: false, servers: [], files: [], warnings: [] }, web: webConfigFromEnv({ CODEBERG_WEB_USE: 'false' }) });
  const scheduler = { create: vi.fn(async () => ({ id: 'wake' })), list: vi.fn(), cancel: vi.fn() };
  const jobs = { start: vi.fn(), get: vi.fn(), list: vi.fn(), cancel: vi.fn() };
  const owner = { chatId: 'chat', sourceRunId: 'turn' };

  try {
    await scheduleContext.run({ ...owner, scheduler }, () => backgroundContext.run({ ...owner, jobs, sleeping: false }, () => agent.ask('Monitor scan')));
    expect(scheduler.create).toHaveBeenCalledOnce();
    expect(model.doGenerateCalls).toHaveLength(1);

    const result = await backgroundContext.run({ ...owner, jobs, sleeping: false }, () => agent.ask('Continue scan'));
    expect(result.answer).toContain('finished');
    expect(model.doGenerateCalls).toHaveLength(2);
  } finally {
    await agent.close();
    await rm(directory, { recursive: true, force: true });
  }
});
