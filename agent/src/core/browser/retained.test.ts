import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { browserConfig } from './config.js';
import { runBrowserTask } from './runner.js';
import { browserConversation } from './scope.js';
import { closeBrowserSession, closeBrowserSessions, listBrowserSessions } from './sessions.js';
import { ToolSettingsStore } from '../../web/tools/settings.js';
import { writeFakeBrowserWorker } from './test-fixtures.js';

let home: string;
let marker: string;
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'browser-retained-test-'));
  marker = join(home, 'lifecycle');
  const uv = await writeFakeBrowserWorker(home);
  env = { ...process.env, CODEBERG_HOME: home, CODEBERG_BROWSER_USE: 'true', CODEBERG_BROWSER_UV: uv };
});

afterEach(async () => {
  await closeBrowserSessions();
  await rm(home, { recursive: true, force: true });
});

it('keeps the browser and temporary profile until explicitly closed, without more agent work', async () => {
  const config = browserConfig(env, 'openai:test-model');
  const result = await runBrowserTask(config, 'Read a page', undefined, { keep_open: true });
  expect(result).toMatchObject({ status: 'completed', kept_open: true, session_id: expect.any(String) });
  const state = JSON.parse(await readFile(marker, 'utf8'));
  expect(state.state).toBe('created');
  expect(state.tasks).toEqual(['Read a page']);
  expect((await stat(state.cwd)).isDirectory()).toBe(true);
  expect(listBrowserSessions(config)).toMatchObject([{ session_id: result.session_id, busy: false }]);

  await closeBrowserSession(config, result.session_id!);

  expect(JSON.parse(await readFile(marker, 'utf8')).state).toBe('closed');
  await expect(stat(state.cwd)).rejects.toThrow();
  expect(() => process.kill(state.pid, 0)).toThrow();
  expect(listBrowserSessions(config)).toEqual([]);
});

it('continues in the same browser and retains it by default, with an option to close after the follow-up', async () => {
  const config = browserConfig(env, 'openai:test-model');
  const first = await runBrowserTask(config, 'Read a page', undefined, { keep_open: true });
  const before = JSON.parse(await readFile(marker, 'utf8'));
  const followup = await runBrowserTask(config, 'Inspect the open tab', undefined, { session_id: first.session_id });

  expect(followup).toMatchObject({ session_id: first.session_id, kept_open: true });
  expect(JSON.parse(await readFile(marker, 'utf8'))).toMatchObject({ pid: before.pid, cwd: before.cwd,
    tasks: ['Read a page', 'Inspect the open tab'], state: 'created' });
  await runBrowserTask(config, 'Finish', undefined, { session_id: first.session_id, keep_open: false });
  expect(JSON.parse(await readFile(marker, 'utf8')).state).toBe('closed');
  expect(listBrowserSessions(config)).toEqual([]);
});

it('keeps sessions scoped to their chat, including after the model-bound toolset changes', async () => {
  const config = browserConfig(env, 'openai:test-model');
  const first = await browserConversation.run('project/chat-one', () => runBrowserTask(config, 'Read', undefined, { keep_open: true }));

  expect(browserConversation.run('project/chat-two', () => listBrowserSessions(config))).toEqual([]);
  await expect(browserConversation.run('project/chat-two', () =>
    runBrowserTask(config, 'Inspect', undefined, { session_id: first.session_id }))).rejects.toThrow('unavailable');
  await expect(browserConversation.run('project/chat-two', () => closeBrowserSession(config, first.session_id!))).rejects.toThrow('unavailable');
  const replacement = { ...config, owner: 'new-model-pool' };
  const next = await browserConversation.run('project/chat-one', () =>
    runBrowserTask(replacement, 'Inspect', undefined, { session_id: first.session_id }));
  expect(next.session_id).toBe(first.session_id);
});

it.each([false, true])('disabling Browser Use closes idle retained sessions even with search control unavailable: %s', async (unavailable) => {
  const store = new ToolSettingsStore({ home, env: { ...env,
    ...(unavailable ? { CODEBERG_SEARCH_CONTROL_URL: 'http://unavailable' } : {}) },
    fetch: async () => { throw new Error('search control unavailable'); } });
  await store.update({ browserUse: true });
  const config = browserConfig({ ...env, ...await store.environment() }, 'openai:test-model');
  const result = await runBrowserTask(config, 'Read', undefined, { keep_open: true });

  await store.update({ browserUse: false });

  expect(JSON.parse(await readFile(marker, 'utf8')).state).toBe('closed');
  expect(listBrowserSessions(config)).toEqual([]);
  await store.update({ browserUse: true });
  await expect(runBrowserTask(config, 'Continue', undefined, { session_id: result.session_id })).rejects.toThrow('unavailable');
});

it('cancelling a continued task closes its retained browser and clears the registry', async () => {
  const config = browserConfig(env, 'openai:test-model');
  const first = await runBrowserTask(config, 'Read', undefined, { keep_open: true });
  const controller = new AbortController();
  const pending = runBrowserTask(config, 'wait', controller.signal, { session_id: first.session_id });
  const rejected = expect(pending).rejects.toThrow('cancelled');
  await vi.waitFor(async () => expect(JSON.parse(await readFile(marker, 'utf8')).tasks).toContain('wait'), { timeout: 5000 });

  controller.abort();
  await rejected;
  expect(JSON.parse(await readFile(marker, 'utf8')).state).toBe('closed');
  expect(listBrowserSessions(config)).toEqual([]);
});

it('shutdown closes retained sessions only under the selected project storage root', async () => {
  const config = browserConfig(env, 'openai:test-model');
  await browserConversation.run(join(home, 'project', 'chat-one'), () =>
    runBrowserTask(config, 'Read', undefined, { keep_open: true }));

  await closeBrowserSessions({ ownerRoot: join(home, 'other-project') });
  expect(JSON.parse(await readFile(marker, 'utf8')).state).toBe('created');
  await closeBrowserSessions({ ownerRoot: join(home, 'project') });
  expect(JSON.parse(await readFile(marker, 'utf8')).state).toBe('closed');
});

it('reports a busy session without closing it and allows an explicit close to cancel its task', async () => {
  const config = browserConfig(env, 'openai:test-model');
  const first = await runBrowserTask(config, 'Read', undefined, { keep_open: true });
  const active = runBrowserTask(config, 'wait', undefined, { session_id: first.session_id });
  const rejected = expect(active).rejects.toThrow('closed');
  await vi.waitFor(async () => expect(JSON.parse(await readFile(marker, 'utf8')).tasks).toContain('wait'), { timeout: 5000 });

  await expect(runBrowserTask(config, 'Overlap', undefined, { session_id: first.session_id })).rejects.toThrow('busy');
  expect(listBrowserSessions(config)).toMatchObject([{ session_id: first.session_id, busy: true }]);
  expect(JSON.parse(await readFile(marker, 'utf8')).state).toBe('created');

  await closeBrowserSession(config, first.session_id!);
  await rejected;
  expect(listBrowserSessions(config)).toEqual([]);
});

it('closes a retained browser after a follow-up fails and preserves the original browser model', async () => {
  const config = browserConfig(env, 'openai:test-model');
  const first = await runBrowserTask(config, 'Read', undefined, { keep_open: true });
  const differentModel = { ...config, model: 'new-chat-model' };
  expect(await runBrowserTask(differentModel, 'Inspect', undefined, { session_id: first.session_id })).toMatchObject({ kept_open: true });

  expect(await runBrowserTask(config, 'fail', undefined, { session_id: first.session_id })).toMatchObject({ status: 'error', kept_open: false });
  expect(JSON.parse(await readFile(marker, 'utf8')).state).toBe('closed');
  expect(listBrowserSessions(config)).toEqual([]);
});

it('can list and close retained browsers after selecting an unsupported browser model', async () => {
  const { browserToolSource } = await import('./tools.js');
  const config = { ...browserConfig(env, 'openai:test-model'), owner: 'owner-one' };
  const result = await runBrowserTask(config, 'Read', undefined, { keep_open: true });
  const tools = await browserToolSource(env, 'custom:unsupported', undefined, 'owner-one').tools();

  expect(await (tools.browser_sessions.execute as Function)({}, {})).toMatchObject({ sessions: [{ session_id: result.session_id }] });
  await (tools.browser_close.execute as Function)({ session_id: result.session_id }, {});
  expect(JSON.parse(await readFile(marker, 'utf8')).state).toBe('closed');
});

it('continues with the original worker after a chat-provider change while preserving ownership and permissions', async () => {
  const { browserToolSource } = await import('./tools.js');
  const store = new ToolSettingsStore({ home, env });
  await store.update({ browserUse: true });
  const currentEnv = { ...env, ...await store.environment() };
  const config = { ...browserConfig(currentEnv, 'openai:test-model'), owner: 'original-agent' };
  const chat = 'project/original-chat';
  const first = await browserConversation.run(chat, () => runBrowserTask(config, 'Read', undefined, { keep_open: true }));
  const before = JSON.parse(await readFile(marker, 'utf8'));
  const tools = await browserToolSource(currentEnv, 'custom:unsupported', undefined, 'replacement-agent').tools();
  const execute = tools.browser_task.execute as Function;
  const followup = () => execute({ task: 'Inspect the open tab', session_id: first.session_id }, {});

  expect(await browserConversation.run(chat, followup)).toMatchObject({ session_id: first.session_id, kept_open: true });
  expect(JSON.parse(await readFile(marker, 'utf8'))).toMatchObject({ pid: before.pid, cwd: before.cwd,
    tasks: ['Read', 'Inspect the open tab'], state: 'created' });
  await expect(browserConversation.run('project/other-chat', followup)).rejects.toThrow('unavailable');
  await expect(browserConversation.run(chat, () => execute({ task: 'Inspect', session_id: 'stale-session' }, {})))
    .rejects.toThrow('unavailable');
  expect(() => execute({ task: 'Start a new browser' }, {})).toThrow('Unsupported');

  await store.update({ browserUse: false });

  await expect(browserConversation.run(chat, followup)).rejects.toThrow('disabled');
  expect(JSON.parse(await readFile(marker, 'utf8')).state).toBe('closed');
});

it('fails a manually closed browser session instead of silently creating another browser', async () => {
  const config = browserConfig(env, 'openai:test-model');
  const first = await runBrowserTask(config, 'Read', undefined, { keep_open: true });
  const state = JSON.parse(await readFile(marker, 'utf8'));
  await writeFile(marker, JSON.stringify({ ...state, manually_closed: true }));

  expect(await runBrowserTask(config, 'Continue', undefined, { session_id: first.session_id })).toMatchObject({ status: 'error', kept_open: false });
  expect(JSON.parse(await readFile(marker, 'utf8')).tasks).toEqual(['Read']);
  expect(listBrowserSessions(config)).toEqual([]);
});
