import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { browserConfig } from './config.js';
import { browserToolSource } from './tools.js';
import { runBrowserTask } from './runner.js';
import { closeBrowserSessions } from './sessions.js';
import { writeFakeBrowserWorker } from './test-fixtures.js';
import { ToolSettingsStore } from '../../web/tools/settings.js';

let home: string;
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'browser-vision-test-'));
  const uv = await writeFakeBrowserWorker(home);
  env = { ...process.env, CODEBERG_HOME: home, CODEBERG_BROWSER_USE: 'true', CODEBERG_BROWSER_UV: uv };
  await writeFile(join(home, 'models.yml'), catalog(['text', 'vision']));
});

afterEach(async () => {
  await closeBrowserSessions();
  await rm(home, { recursive: true, force: true });
});

it.each([['text'], undefined])('blocks models without a vision declaration before starting the worker: %s', async (inputs) => {
  await writeFile(join(home, 'models.yml'), catalog(inputs));

  await expect(runBrowserTask(browserConfig(env, 'openai:test-model'), 'Read a page')).rejects.toThrow('vision');
  await expect(readFile(join(home, 'lifecycle'))).rejects.toThrow();
});

it('blocks unknown models even when the screenshots toggle is enabled', async () => {
  await expect(runBrowserTask(browserConfig({ ...env, CODEBERG_BROWSER_VISION: 'true' }, 'openai:unknown'), 'Read'))
    .rejects.toThrow('vision');
  await expect(readFile(join(home, 'lifecycle'))).rejects.toThrow();
});

it('persists screenshot access independently and applies each change to the next task in a retained browser', async () => {
  const store = new ToolSettingsStore({ home, env });
  expect(await store.current()).toMatchObject({ browserVision: false });
  const config = browserConfig({ ...env, ...await store.environment() }, 'openai:test-model');
  expect(await store.update({ browserVision: true })).toMatchObject({ browserUse: true, browserVision: true, webSearch: false });
  const first = await runBrowserTask(config, 'Read', undefined, { keep_open: true });
  const before = JSON.parse(await readFile(join(home, 'lifecycle'), 'utf8'));

  expect(await store.update({ browserVision: false })).toMatchObject({ browserUse: true, browserVision: false });
  expect(await runBrowserTask(config, 'Inspect', undefined, { session_id: first.session_id })).toMatchObject({ kept_open: true });
  expect(JSON.parse(await readFile(join(home, 'lifecycle'), 'utf8'))).toMatchObject({ pid: before.pid, visions: [true, false] });
  expect(await new ToolSettingsStore({ home, env }).current()).toMatchObject({ browserVision: false });
  await expect(store.update({ browserVision: 'yes' })).rejects.toThrow('boolean');
});

it('requires a declared vision browser override regardless of the chat model capabilities', async () => {
  const tools = await browserToolSource({ ...env, CODEBERG_BROWSER_MODEL: 'openai:unknown' }, 'openai:test-model').tools();

  await expect((tools.browser_task.execute as Function)({ task: 'Read' }, {})).rejects.toThrow('vision');
  await expect(readFile(join(home, 'lifecycle'))).rejects.toThrow();
});

it('honors the selected catalog entry when aliases share a wire model', async () => {
  const tools = await browserToolSource(env, 'openai:test-model', undefined, 'chat-owner', ['text']).tools();

  await expect((tools.browser_task.execute as Function)({ task: 'Read' }, {})).rejects.toThrow('vision');
  await expect(readFile(join(home, 'lifecycle'))).rejects.toThrow();
});

it('allows a declared vision browser override while the main chat is text-only', async () => {
  const tools = await browserToolSource({ ...env, CODEBERG_BROWSER_MODEL: 'openai:test-model' },
    'openai:text-chat', undefined, 'chat-owner', ['text']).tools();

  expect(await (tools.browser_task.execute as Function)({ task: 'Read' }, {})).toMatchObject({ status: 'completed' });
  expect(JSON.parse(await readFile(join(home, 'lifecycle'), 'utf8')).visions).toEqual([false]);
});

it.each(['providers: [invalid', '{}'])('rejects missing or invalid capability catalogs: %s', async (content) => {
  await writeFile(join(home, 'models.yml'), content);

  await expect(runBrowserTask(browserConfig(env, 'openai:test-model'), 'Read')).rejects.toThrow('vision');
  await expect(readFile(join(home, 'lifecycle'))).rejects.toThrow();
});

it('migrates legacy vision preferences, preserves them during other updates, and respects the master switch', async () => {
  await writeFile(join(home, 'tool-settings.json'), JSON.stringify({ webSearch: false, browserUse: true }));
  const store = new ToolSettingsStore({ home, env: { ...env, CODEBERG_BROWSER_VISION: 'true' } });

  expect(await store.current()).toMatchObject({ browserVision: true });
  await store.update({ webSearch: false });
  expect(await store.environment()).toMatchObject({ CODEBERG_BROWSER_VISION: 'true' });
  await store.update({ browserVision: false });
  expect(await store.environment()).toMatchObject({ CODEBERG_BROWSER_VISION: 'false' });

  const disabled = new ToolSettingsStore({ home, env: { CODEBERG_WEB_USE: 'false' } });
  await expect(disabled.update({ browserVision: true })).rejects.toThrow('CODEBERG_WEB_USE');
});

function catalog(inputs?: string[]) {
  return JSON.stringify({ providers: { openai: { models: {
    browser: { model: 'test-model', context_window: 32000, efforts: ['provider-default'], ...(inputs ? { inputs } : {}) },
  } } } });
}
