import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
import { expect, it, vi } from 'vitest';

import { Agent } from '../agent.js';
import { DaemonClient } from '../client.js';
import { ContextStore } from '../context/store.js';
import { webConfigFromEnv } from '../web/config.js';
import { backgroundContext } from '../background/context.js';

function agent(): Agent {
  const daemon = new DaemonClient('http://unused.test');
  vi.spyOn(daemon, 'listTools').mockResolvedValue([]);
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text: 'Done' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }),
  });

  return new Agent({
    model,
    daemon,
    decisionModel: null,
    learning: false,
    promptHooks: [],
    env: { CODEBERG_HOME: mkdtempSync(join(tmpdir(), 'cberg-server-tools-')) },
    context: ContextStore.open(mkdtempSync(join(tmpdir(), 'cberg-server-ctx-'))),
    mcp: { enabled: false, servers: [], files: [], warnings: [] },
    web: webConfigFromEnv({ CODEBERG_WEB_USE: 'false' }),
  });
}

it('omits schedule and background tools from a CLI ask', async () => {
  const cli = agent();
  await cli.ask('Hi');
  const names = Object.keys((await cli.toolLoopAgent()).tools);

  expect(names).not.toContain('sleep_agent');
  expect(names).not.toContain('schedule_run');
  await cli.close();
});

it('registers schedule and background tools for the server loop', async () => {
  const server = agent();
  const names = Object.keys((await server.toolLoopAgent()).tools);

  expect(names).toContain('sleep_agent');
  expect(names).toContain('schedule_run');
  await server.close();
});

it('keeps server tools when ask runs inside a server-owned chat', async () => {
  const scoped = agent();
  const owner = { chatId: 'chat', sourceRunId: 'turn' };
  await backgroundContext.run(
    { ...owner, jobs: { start: vi.fn(), get: vi.fn(), list: vi.fn(), cancel: vi.fn() }, sleeping: false },
    () => scoped.ask('Hi'),
  );
  const names = Object.keys((await scoped.toolLoopAgent()).tools);

  expect(names).toContain('sleep_agent');
  await scoped.close();
});
