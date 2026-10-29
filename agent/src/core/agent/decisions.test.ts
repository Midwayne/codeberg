import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, expect, it, vi } from 'vitest';
import { Agent } from '../agent.js';
import { DaemonClient } from '../client.js';
import { ContextStore } from '../context/store.js';
import type { DecisionModel } from '../decisions/types.js';
import { webConfigFromEnv } from '../web/config.js';

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const decisionModel: DecisionModel = {
  key: 'openai:decisions', provider: 'openai', label: 'Decisions', model: 'gpt-6-luna',
  api: 'openai', endpoint: 'https://example.test/decisions', apiKeyEnv: 'TEST_DECISION_KEY',
};

const decision = {
  state: 'Task: locate caching. Search results: cache.ts implements cache invalidation; routes.ts handles URLs.',
  questions: [{ name: 'file', type: 'choice', instructions: 'Which file should be read first?',
    choices: [{ value: 'cache.ts' }, { value: 'routes.ts' }] }],
};

const calls = [
  { toolName: 'grep', input: { pattern: 'cache' } },
  { toolName: 'decide', input: decision },
  { toolName: 'read_file', input: { path: 'cache.ts' } },
];

async function fixture(enabled = true, forwardFiles = false) {
  const home = await mkdtemp(join(tmpdir(), 'codeberg-decision-agent-'));
  dirs.push(home);
  const daemon = new DaemonClient('http://unused.test');
  vi.spyOn(daemon, 'listTools').mockResolvedValue([
    { name: 'grep', description: 'Search files', schema: { type: 'object', properties: { pattern: { type: 'string' } } } },
    { name: 'read_file', description: 'Read file', schema: { type: 'object', properties: { path: { type: 'string' } } } },
  ]);
  const read = vi.spyOn(daemon, 'callTool').mockImplementation(async (name, args) => name === 'grep'
    ? [{ path: 'cache.ts', snippet: 'invalidate cache' }, { path: 'routes.ts', snippet: 'route request' }]
    : { path: args.path, content: 'export function invalidate() {}',
      start_line: args.start_line ?? 1, end_line: args.end_line ?? 1, total_lines: 400 });
  const plan = forwardFiles ? [calls[0]!, { toolName: 'decide', input: {
    state: 'Find cache invalidation source', files: [{ repo: 'app', path: 'cache.ts' }, { repo: 'app', path: 'routes.ts' }],
  } }, calls[2]!] : calls;
  let step = 0;
  const model = new MockLanguageModelV4({ doGenerate: async () => {
    const call = enabled ? plan[step++] : undefined;

    return {
      content: call ? [{ type: 'tool-call', toolCallId: String(step), toolName: call.toolName, input: JSON.stringify(call.input) }]
        : [{ type: 'text', text: 'Caching is implemented in cache.ts.' }],
      finishReason: { unified: call ? 'tool-calls' : 'stop', raw: undefined },
      usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 } },
      warnings: [],
    };
  } });
  const onDecisionUsage = vi.fn().mockResolvedValue(undefined);
  const agent = new Agent({ model, daemon, decisionModel: enabled ? decisionModel : null, onDecisionUsage,
    env: { CODEBERG_HOME: home, TEST_DECISION_KEY: 'test' }, learning: false, promptHooks: [],
    web: webConfigFromEnv({ CODEBERG_WEB_USE: 'false' }),
    mcp: { enabled: false, servers: [], files: [], warnings: [] }, context: ContextStore.open(join(home, 'context')) });

  return { agent, model, read, onDecisionUsage };
}

it('lets the main agent use decisions between search and file reading without narrowing other tools', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({
    answers: [{ name: 'file', type: 'choice', choice: 'cache.ts', confidence: 0.95 }],
    usage: { input_tokens: 100, output_tokens: 0 },
  }));
  vi.stubGlobal('fetch', fetch);
  const { agent, model, read, onDecisionUsage } = await fixture();
  try {
    expect((await agent.ask('Find the caching implementation.')).answer).toContain('cache.ts');
    expect(read.mock.calls.map(([name]) => name)).toEqual(['grep', 'read_file']);
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(fetch.mock.calls[0]![1].body).input).toBe(decision.state);
    expect(onDecisionUsage).toHaveBeenCalledWith(decisionModel, { input_tokens: 100, output_tokens: 0 });
    expect(JSON.stringify(model.doGenerateCalls[2]?.prompt)).toContain('"choice":"cache.ts"');
    for (const call of model.doGenerateCalls) {
      expect(call.tools?.map((item) => item.name)).toEqual(expect.arrayContaining(['grep', 'read_file', 'decide']));
      expect(JSON.stringify(call.prompt)).toContain('Decisions strategy:');
    }
  } finally {
    await agent.close();
  }
});

it('returns decisions failures as tool errors and lets the main agent continue', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('provider down', { status: 503 })));
  const { agent, model, read } = await fixture();
  try {
    expect((await agent.ask('Find caching.')).answer).toContain('cache.ts');
    expect(JSON.stringify(model.doGenerateCalls[2]?.prompt)).toContain('HTTP 503');
    expect(read).toHaveBeenCalledWith('read_file', { path: 'cache.ts' }, expect.any(AbortSignal));
  } finally {
    await agent.close();
  }
});

it('does not register or call a decisions API when disabled', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const { agent, model } = await fixture(false);
  try {
    await agent.ask('Hello');
    expect(model.doGenerateCalls[0]?.tools?.map((item) => item.name)).not.toContain('decide');
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).not.toContain('Decisions strategy:');
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    await agent.close();
  }
});

it('lets the main agent rank unread files and receive probabilities without their source bodies', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ answers: [
    { name: 'file_1', type: 'predicate', probability: 0.95 },
    { name: 'file_2', type: 'predicate', probability: 0.8 },
  ] }));
  vi.stubGlobal('fetch', fetch);
  const { agent, model, read } = await fixture(true, true);
  try {
    await agent.ask('Investigate cache invalidation.');
    const beforeReading = JSON.stringify(model.doGenerateCalls[2]?.prompt);
    const afterReading = JSON.stringify(model.doGenerateCalls[3]?.prompt);

    expect(beforeReading).toContain('0.95');
    expect(beforeReading).not.toContain('export function invalidate');
    expect(afterReading).toContain('export function invalidate');
    expect(JSON.parse(fetch.mock.calls[0]![1].body).input[0].content[0].text).toContain('export function invalidate');
    expect(read.mock.calls.map(([name]) => name)).toEqual(['grep', 'read_file', 'read_file', 'read_file']);
  } finally {
    await agent.close();
  }
});
