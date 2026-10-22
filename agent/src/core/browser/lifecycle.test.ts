import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { SearchRuns } from '../../web/runs/manager.js';
import { WebSessionStore } from '../../web/sessions/store.js';
import { browserConfig, type BrowserConfig } from './config.js';
import { runBrowserTask } from './runner.js';
import { browserConversation } from './scope.js';
import { closeBrowserSessions } from './sessions.js';
import { writeFakeBrowserWorker } from './test-fixtures.js';

let home: string;
let config: BrowserConfig;
let store: WebSessionStore;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'browser-lifecycle-test-'));
  const uv = await writeFakeBrowserWorker(home);
  config = browserConfig({ ...process.env, CODEBERG_HOME: home, CODEBERG_BROWSER_USE: 'true', CODEBERG_BROWSER_UV: uv }, 'openai:test-model');
  store = new WebSessionStore(join(home, 'web-sessions'));
});

afterEach(async () => {
  await closeBrowserSessions();
  await rm(home, { recursive: true, force: true });
});

it('assigns the server-owned chat scope and closes idle browsers when the project run service shuts down', async () => {
  let owner: string | undefined;
  const runs = new SearchRuns(store, async () => {
    owner = browserConversation.getStore();
    await runBrowserTask(config, 'Read', undefined, { keep_open: true });

    return { stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: 'finish', finishReason: 'stop' });
      controller.close();
    } }) };
  });
  const run = await runs.admit({ chatId: 'chat-one', requestId: 'request-one',
    messages: [{ id: 'user-one', role: 'user', parts: [{ type: 'text', text: 'Read and keep it open' }] }] });
  await run.done;

  expect(owner).toBe(join(store.dir, 'chat-one'));
  expect(JSON.parse(await readFile(join(home, 'lifecycle'), 'utf8')).state).toBe('created');
  await runs.close();
  expect(JSON.parse(await readFile(join(home, 'lifecycle'), 'utf8')).state).toBe('closed');
});

it('closes a chat-owned browser when its saved chat is deleted', async () => {
  await store.upsert({ id: 'chat-one', title: 'Browser task', messages: [] });
  await browserConversation.run(join(store.dir, 'chat-one'), () =>
    runBrowserTask(config, 'Read', undefined, { keep_open: true }));

  await store.remove('chat-one');

  expect(JSON.parse(await readFile(join(home, 'lifecycle'), 'utf8')).state).toBe('closed');
  expect(await store.load('chat-one')).toBeNull();
});
