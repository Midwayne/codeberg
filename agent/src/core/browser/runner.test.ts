import { closeBrowserSessions } from './sessions.js';
import { writeFakeBrowserWorker } from './test-fixtures.js';
import { MockLanguageModelV4 } from 'ai/test';
import { Agent } from '../agent.js';
import { DaemonClient } from '../client.js';
import { ContextStore } from '../context/store.js';
import { profileFor } from '../../providers/profiles.js';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { browserConfig } from './config.js';
import { runBrowserTask } from './runner.js';
import { ToolSettingsStore } from '../../web/tools/settings.js';

let home: string;
let marker: string;
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'browser-runner-test-'));
  marker = join(home, 'lifecycle');
  const uv = await writeFakeBrowserWorker(home);
  env = { ...process.env, CODEBERG_HOME: home, CODEBERG_BROWSER_USE: 'true', CODEBERG_BROWSER_UV: uv };
});

afterEach(async () => {
  await closeBrowserSessions();
  await rm(home, { recursive: true, force: true });
});

it('runs the embedded worker with its own browser loop and cleans its temporary profile', async () => {
  expect(await runBrowserTask(browserConfig(env, 'openai:test-model'), 'Read a page')).toEqual({
    status: 'completed', result: 'Browser task result', urls: ['https://example.com'],
  });
  const state = JSON.parse(await readFile(marker, 'utf8'));

  expect(state.python_request).toBe('>=3.11,<4.0');
  expect(state.state).toBe('closed');
  await expect(readFile(join(state.cwd, 'profile'))).rejects.toThrow();
  await expect(import('node:fs/promises').then(({ stat }) => stat(state.cwd))).rejects.toThrow();
});

it('preserves incomplete outcomes and closes the browser on worker exceptions without leaking errors', async () => {
  expect(await runBrowserTask(browserConfig(env, 'openai:test-model'), 'incomplete')).toMatchObject({ status: 'incomplete' });
  const failure = await runBrowserTask(browserConfig(env, 'openai:test-model'), 'fail');
  expect(failure.status).toBe('error');
  expect(failure.result).not.toContain('SECRET');
  expect(JSON.parse(await readFile(marker, 'utf8')).state).toBe('closed');
});

it('cancels an active worker when its chat signal aborts and waits for browser cleanup', async () => {
  const controller = new AbortController();
  const result = runBrowserTask(browserConfig(env, 'openai:test-model'), 'wait', controller.signal);
  const rejected = expect(result).rejects.toThrow('cancelled');
  await vi.waitFor(async () => expect(JSON.parse(await readFile(marker, 'utf8')).state).toBe('created'), { timeout: 5000 });

  controller.abort();
  await rejected;
  const state = JSON.parse(await readFile(marker, 'utf8'));
  expect(state.state).toBe('closed');
  expect(() => process.kill(state.pid, 0)).toThrow();
});

it('disables active workers globally and prevents cached agents from starting another task', async () => {
  const store = new ToolSettingsStore({ home, env });
  await store.update({ browserUse: true });
  const config = browserConfig({ ...env, ...await store.environment() }, 'openai:test-model');
  const result = runBrowserTask(config, 'wait');
  const rejected = expect(result).rejects.toThrow('cancelled');
  await vi.waitFor(async () => expect(JSON.parse(await readFile(marker, 'utf8')).state).toBe('created'), { timeout: 5000 });

  await store.update({ browserUse: false });
  await rejected;
  expect(JSON.parse(await readFile(marker, 'utf8')).state).toBe('closed');
  await expect(runBrowserTask(config, 'Read another page')).rejects.toThrow('disabled');
});

it('reports a missing uv executable and rejects invalid tasks without launching a browser', async () => {
  env.CODEBERG_BROWSER_UV = join(home, 'missing');
  const config = browserConfig(env, 'openai:test-model');
  await expect(runBrowserTask(config, 'Read a page')).rejects.toThrow('Install uv');
  await expect(runBrowserTask(config, ' ')).rejects.toThrow('characters');
  await expect(readFile(marker)).rejects.toThrow();
});

it.each(['missing', 'legacy'])('honors environment opt-in with %s saved settings', async (kind) => {
  if (kind === 'legacy') await writeFile(join(home, 'tool-settings.json'), JSON.stringify({ webSearch: false }));

  const store = new ToolSettingsStore({ home, env });
  expect(await store.current()).toMatchObject({ browserUse: true });
  const config = browserConfig({ ...env, ...await store.environment() }, 'openai:test-model');

  expect(await runBrowserTask(config, 'Read a page')).toMatchObject({ status: 'completed' });
});

it.each(['{invalid', '{"webSearch":false,"browserUse":"true"}', '{"browserUse":true}'])(
  'rejects invalid saved settings instead of falling back to environment opt-in: %s', async (saved) => {
    const settingsPath = join(home, 'tool-settings.json');
    await writeFile(settingsPath, saved);
    const config = browserConfig({ ...env, CODEBERG_BROWSER_SETTINGS_PATH: settingsPath }, 'openai:test-model');

    await expect(runBrowserTask(config, 'Read a page')).rejects.toThrow();
    await expect(readFile(marker)).rejects.toThrow();
  },
);

it.each([false, true])('lets Codeberg delegate, answer, and close its owned browser on Agent.close (retained: %s)', async (keepOpen) => {
  let steps = 0;
  const model = new MockLanguageModelV4({ doGenerate: async ({ prompt, tools }) => {
    expect(tools?.some((definition) => definition.type === 'function' && definition.name === 'browser_task')).toBe(true);
    const delegated = steps++ === 0;
    if (!delegated) expect(JSON.stringify(prompt)).toContain('Browser task result');

    return {
      content: delegated ? [{ type: 'tool-call' as const, toolCallId: 'browser-1', toolName: 'browser_task',
        input: JSON.stringify({ task: 'Read a page', keep_open: keepOpen }) }] : [{ type: 'text' as const, text: 'The browser task finished.' }],
      finishReason: { unified: delegated ? 'tool-calls' as const : 'stop' as const, raw: undefined },
      usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 10, text: 10, reasoning: 0 } },
      warnings: [],
    };
  } });
  const daemon = new DaemonClient('http://unused');
  vi.spyOn(daemon, 'listTools').mockResolvedValue([]);
  const agent = new Agent({ model, daemon, env, learning: false, promptHooks: [],
    profile: profileFor('openai:test-model', {}), context: ContextStore.open(join(home, 'context')),
    mcp: { enabled: false, servers: [], files: [], warnings: [] } });

  try {
    expect((await agent.ask('Open a browser and read the page')).answer).toBe('The browser task finished.');
    expect(steps).toBe(2);
    expect(JSON.parse(await readFile(marker, 'utf8')).state).toBe(keepOpen ? 'created' : 'closed');
  } finally {
    await agent.close();
  }
  expect(JSON.parse(await readFile(marker, 'utf8')).state).toBe('closed');
});
