import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, expect, it, vi } from 'vitest';

import { Agent } from '../agent.js';
import { DaemonClient } from '../client.js';
import { ContextStore } from '../context/store.js';
import { webConfigFromEnv } from '../web/config.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'codeberg-fast-agent-'));
  dirs.push(home);

  const daemon = new DaemonClient('http://unused.test');
  vi.spyOn(daemon, 'listTools').mockResolvedValue([
    { name: 'grep', description: 'Search files', schema: { type: 'object', properties: { pattern: { type: 'string' } } } },
  ]);

  const model = new MockLanguageModelV4({ doGenerate: async () => ({
    content: [{ type: 'text', text: 'Chunking lives in core/src/chunk.' }],
    finishReason: { unified: 'stop', raw: undefined },
    usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 } },
    warnings: [],
  }) });

  const agent = new Agent({ model, daemon, decisionModel: null, learning: false,
    env: { CODEBERG_HOME: home, CODEBERG_SUBAGENTS_USE: 'true' },
    web: webConfigFromEnv({ CODEBERG_WEB_USE: 'false' }),
    mcp: { enabled: false, servers: [], files: [], warnings: [] }, context: ContextStore.open(join(home, 'context')) });

  return { agent, model };
}

const offered = (model: MockLanguageModelV4, call: number) => model.doGenerateCalls[call]?.tools?.map((item) => item.name);

it('offers subagents on a normal turn and hides them on a /fast turn of the same agent', async () => {
  const { agent, model } = await fixture();

  try {
    await agent.ask('where is chunking?');
    expect(offered(model, 0)).toEqual(expect.arrayContaining(['grep', 'run_subagents']));

    await agent.ask('/fast where is chunking?');
    expect(offered(model, 1)).toContain('grep');
    expect(offered(model, 1)).not.toContain('run_subagents');
    expect(offered(model, 1)).not.toContain('start_background_tool');
  } finally {
    await agent.close();
  }
});
