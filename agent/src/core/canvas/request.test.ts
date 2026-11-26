import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, expect, it, vi } from 'vitest';

import { Agent } from '../agent.js';
import { DaemonClient, DEFAULT_DAEMON_URL } from '../client.js';
import { ContextStore } from '../context/store.js';
import { webConfigFromEnv } from '../web/config.js';
import { DIAGRAM_REQUEST, diagramRequested } from './request.js';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const user = (metadata?: unknown) => ({ role: 'user', parts: [], ...(metadata ? { metadata } : {}) });

it('asks for a diagram only when the newest user message turned it on', () => {
  expect(diagramRequested([user(DIAGRAM_REQUEST), { role: 'assistant', parts: [] }])).toBe(true);
  expect(diagramRequested([user(DIAGRAM_REQUEST), { role: 'assistant' }, user()])).toBe(false);
  expect(diagramRequested([user({ codeberg: { kind: 'scheduled-follow-up', scheduleId: 'x' } })])).toBe(false);
  expect(diagramRequested([user({ codeberg: { diagram: 'yes' } }), null])).toBe(false);
  expect(diagramRequested([])).toBe(false);
});

/** The first model request of an agent with the canvas enabled in Settings. */
async function firstRequest(canvas: boolean | undefined) {
  const home = mkdtempSync(join(tmpdir(), 'cberg-diagram-'));
  dirs.push(home);

  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text: 'Done' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
      warnings: [],
    }),
  });

  const daemon = new DaemonClient(DEFAULT_DAEMON_URL);
  vi.spyOn(daemon, 'listTools').mockResolvedValue([]);

  const agent = new Agent({
    model, daemon, canvas, learning: false, promptHooks: [],
    env: { CODEBERG_HOME: home, CODEBERG_CANVAS_USE: 'true' },
    profile: { provider: 'openai', modelId: 'gpt', contextWindow: 128000, cache: 'openai' },
    web: webConfigFromEnv({ CODEBERG_WEB_USE: 'false' }),
    mcp: { enabled: false, servers: [], files: [], warnings: [] },
    context: ContextStore.open(join(home, 'context')),
  });

  await (await agent.toolLoopAgent()).generate({ prompt: 'Explain the indexer' });
  await agent.close();

  const call = model.doGenerateCalls[0]!;

  return {
    tools: (call.tools ?? []).map((tool) => tool.name).filter((name) => name.startsWith('canvas_')),
    prompt: JSON.stringify(call.prompt),
  };
}

it('sends the canvas tools and instructions only to a turn that asked for a diagram', async () => {
  const asked = await firstRequest(true);
  const plain = await firstRequest(false);

  expect(asked.tools).toContain('canvas_add');
  expect(asked.prompt).toContain('local canvas');
  expect(plain.tools).toEqual([]);
  expect(plain.prompt).not.toContain('local canvas');
});

it('tells only a Diagram turn that the user asked for one; terminal runs draw only when it helps', async () => {
  const asked = await firstRequest(true);
  const terminal = await firstRequest(undefined);

  expect(asked.prompt).toContain('The user asked for a diagram');
  expect(terminal.tools).toContain('canvas_add');
  expect(terminal.prompt).not.toContain('The user asked for a diagram');
  expect(terminal.prompt).toContain('Skip diagrams for simple answers');
});
