import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { Agent } from '../agent.js';
import { ContextStore } from '../context/store.js';
import { DaemonClient } from '../client.js';
import { profileFor } from '../../providers/profiles.js';
import { writeFakeBrowserWorker } from './test-fixtures.js';

let home: string;
let agent: Agent | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'browser-wait-test-'));
});

afterEach(async () => {
  await agent?.close();
  vi.useRealTimers();
  await rm(home, { recursive: true, force: true });
});

it.each(['generate', 'stream'] as const)('waits past former deadlines and resumes %s when Browser Use finishes', async (mode) => {
  let calls = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      const call = calls++ === 0;
      if (!call) expect(JSON.stringify(prompt)).toContain('Browser task result');

      return { content: content(call), finishReason: finishReason(call), usage, warnings: [] };
    },
    doStream: async ({ prompt }) => {
      const call = calls++ === 0;
      if (!call) expect(JSON.stringify(prompt)).toContain('Browser task result');

      return { stream: new ReadableStream({ start(controller) {
        if (call) controller.enqueue(browserCall());
        else {
          controller.enqueue({ type: 'text-start', id: 'answer' });
          controller.enqueue({ type: 'text-delta', id: 'answer', delta: 'Browser finished.' });
          controller.enqueue({ type: 'text-end', id: 'answer' });
        }

        controller.enqueue({ type: 'finish', finishReason: finishReason(call), usage });
        controller.close();
      } }) };
    },
  });
  agent = await createAgent(model);
  const loop = await agent.toolLoopAgent();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let settled = false;
  const result = (mode === 'generate' ? loop.generate({ prompt: 'Browse' })
    : loop.stream({ prompt: 'Browse' }).then(async (stream) => ({ text: await stream.text })))
    .finally(() => { settled = true; });
  void result.catch(() => undefined);

  const marker = join(home, 'lifecycle');
  await vi.waitFor(async () => expect(JSON.parse(await readFile(marker, 'utf8')).tasks).toContain('wait-for-release'), { timeout: 5000 });
  await vi.advanceTimersByTimeAsync(60 * 60_000);

  expect(settled).toBe(false);
  expect(calls).toBe(1);
  const state = JSON.parse(await readFile(marker, 'utf8'));
  expect(state.state).toBe('created');
  await writeFile(join(state.cwd, 'release'), 'finish');

  expect((await result).text).toBe('Browser finished.');
  expect(calls).toBe(2);
  expect(JSON.parse(await readFile(marker, 'utf8'))).toMatchObject({ state: 'closed', max_steps: expect.any(Number) });
  expect(JSON.parse(await readFile(marker, 'utf8')).max_steps).toBeGreaterThan(50);
});

async function createAgent(model: MockLanguageModelV4) {
  const uv = await writeFakeBrowserWorker(home);
  const daemon = new DaemonClient('http://unused');
  vi.spyOn(daemon, 'listTools').mockResolvedValue([]);

  return new Agent({ model, daemon, learning: false, promptHooks: [],
    env: { ...process.env, CODEBERG_HOME: home, CODEBERG_BROWSER_USE: 'true', CODEBERG_BROWSER_UV: uv },
    profile: profileFor('openai:test-model', {}), context: ContextStore.open(join(home, 'context')),
    mcp: { enabled: false, servers: [], files: [], warnings: [] } });
}

function content(call: boolean) {
  return call ? [browserCall()] : [{ type: 'text' as const, text: 'Browser finished.' }];
}

function browserCall() {
  return { type: 'tool-call' as const, toolCallId: 'browser-1', toolName: 'browser_task',
    input: JSON.stringify({ task: 'wait-for-release' }) };
}

function finishReason(call: boolean) {
  return { unified: call ? 'tool-calls' as const : 'stop' as const, raw: undefined };
}

const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 } };
