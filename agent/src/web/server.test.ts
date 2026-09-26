import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { reasoningFromEnv } from '../core/config.js';
import { LearningService } from '../core/learning/service.js';
import {
  CHAT_PATH,
  CHAT_SEARCH_PATH,
  COMMANDS_PATH,
  META_PATH,
  SESSIONS_PATH,
  createWebServer,
  type ChatResponder,
  type WebServerOptions,
} from './server.js';
import { WebSessionStore } from './sessions.js';
import { ModelSettingsStore } from './model-settings.js';
import { formatWebTitle } from './title.js';

// `agent` is unused when `respond` is injected; cast a stub so the tests can
// drive routing without a live model.
const stubAgent = {} as WebServerOptions['agent'];

let baseUrl = '';
let close: (() => Promise<void>) | undefined;
const tempDirs: string[] = [];

async function start(opts: Partial<WebServerOptions> = {}): Promise<string> {
  const server = createWebServer({
    agent: stubAgent,
    title: 'test-title',
    ...opts,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  close = () =>
    new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  baseUrl = `http://127.0.0.1:${port}`;
  return baseUrl;
}

function tempSessionStore(): WebSessionStore {
  const dir = mkdtempSync(join(tmpdir(), 'codeberg-web-sessions-'));
  tempDirs.push(dir);
  return new WebSessionStore(dir);
}

function tempLearning(): LearningService {
  const dir = mkdtempSync(join(tmpdir(), 'codeberg-learning-'));
  tempDirs.push(dir);
  return new LearningService({ root: dir });
}

function makeStaticRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'codeberg-web-'));
  tempDirs.push(dir);
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>spa</title><div id=root></div>');
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), "console.log('hi')");
  return dir;
}

afterEach(async () => {
  await close?.();
  close = undefined;
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('web server', () => {
  it('serves the embedded fallback page (no build) with the title substituted', async () => {
    await start();
    const res = await fetch(baseUrl + '/');
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(body).toContain('test-title');
    expect(body).toContain('id="messages"');
    expect(body).not.toContain('{{TITLE}}');
    // The command-menu regex must survive bundling with a single backslash, or
    // the fallback page's "/" autocomplete silently never opens.
    expect(body).toContain('/^\\/([a-zA-Z-]*)$/');
    expect(body).toContain('id="commands"');
  });

  it('escapes the title to avoid HTML injection in the fallback page', async () => {
    await start({ title: '<script>"x"' });
    const body = await (await fetch(baseUrl + '/')).text();
    expect(body).toContain('&lt;script&gt;&quot;x&quot;');
    expect(body).not.toContain('<script>"x"');
  });

  it('returns the title for the SPA header', async () => {
    await start({ title: 'gpt-5.6-sol · reasoning: high' });
    const res = await fetch(baseUrl + META_PATH);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ title: 'gpt-5.6-sol · reasoning: high', capabilities: { learning: false } });
  });

  it('persists independent UI model selections and binds each chat request to a snapshot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codeberg-models-'));
    tempDirs.push(dir);
    writeFileSync(join(dir, 'models.yml'), 'providers:\n  openai:\n    models:\n      small:\n        model: alpha\n        context_window: 50000\n        efforts: [low, high]\n      large:\n        model: alpha\n        context_window: 90000\n        efforts: [none, low]\n');
    const models = new ModelSettingsStore({
      home: dir,
      defaultChat: { key: 'openai:small', effort: 'low' },
      defaultLearning: { key: 'openai:large', effort: 'none' },
    });
    const received: string[] = [];
    await start({ modelSettings: models, respond: async (res, _messages, selected) => {
      received.push(`${selected?.key}:${selected?.model}:${selected?.effort}:${selected?.contextWindow}`);
      res.end('ok');
    } });

    const initial = await (await fetch(`${baseUrl}/api/models`)).json();
    expect(initial.chat).toEqual({ key: 'openai:small', effort: 'low' });
    expect(initial.learning).toEqual({ key: 'openai:large', effort: 'none' });
    const send = () => fetch(baseUrl + CHAT_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"messages":[]}' });
    expect((await send()).status).toBe(200);
    const saved = await fetch(`${baseUrl}/api/models`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat: { key: 'openai:large', effort: 'low' }, learning: { key: 'openai:small', effort: 'high' } }),
    });
    expect(saved.status).toBe(200);
    expect((await (await fetch(baseUrl + META_PATH)).json()).title).toContain('large');
    expect((await send()).status).toBe(200);
    expect(received).toEqual(['openai:small:openai:alpha:low:50000', 'openai:large:openai:alpha:low:90000']);

    const invalid = await fetch(`${baseUrl}/api/models`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat: { key: 'openai:unlisted', effort: 'high' }, learning: initial.learning }),
    });
    expect(invalid.status).toBe(400);
    expect((await (await fetch(`${baseUrl}/api/models`)).json()).chat.key).toBe('openai:large');
  });

  it('omits learning routes and collection when the learning service is absent', async () => {
    await start({ sessionStore: tempSessionStore() });
    expect((await fetch(`${baseUrl}/api/learning/status`)).status).toBe(404);
    const saved = await fetch(`${baseUrl}${SESSIONS_PATH}/disabled`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Works without learning', messages: [] }),
    });
    expect(saved.status).toBe(200);
    expect((await (await fetch(`${baseUrl}${SESSIONS_PATH}/disabled`)).json()).title).toBe('Works without learning');
  });

  it('shows only the model name and configured reasoning in both web headers', async () => {
    await start({
      title: formatWebTitle(
        'openai:gpt-5.6-sol',
        reasoningFromEnv({ CODEBERG_REASONING: 'high' }),
      ),
    });

    expect(await (await fetch(baseUrl + META_PATH)).json()).toEqual({
      title: 'gpt-5.6-sol · reasoning: high',
      capabilities: { learning: false },
    });
    const html = await (await fetch(baseUrl + '/')).text();
    expect(html).toContain('<header>gpt-5.6-sol · reasoning: high</header>');
    expect(html).not.toContain('openai:');
    expect(html).not.toContain('127.0.0.1:48080');
  });

  it('labels an unset reasoning effort as the provider default', () => {
    expect(formatWebTitle('anthropic:claude-sonnet', reasoningFromEnv({}))).toBe(
      'claude-sonnet · reasoning: provider-default',
    );
  });

  it('serves the built-in slash-command catalog for autocomplete', async () => {
    await start();
    const res = await fetch(baseUrl + COMMANDS_PATH);
    expect(res.headers.get('content-type')).toContain('application/json');
    const commands = (await res.json()) as { trigger: string }[];
    expect(commands.some((c) => c.trigger === '/enhance')).toBe(true);
  });

  it('serves injected commands when provided', async () => {
    const commands = [{ trigger: '/x', title: 'X', summary: 's', description: 'd' }];
    await start({ commands });
    const res = await fetch(baseUrl + COMMANDS_PATH);
    expect(await res.json()).toEqual(commands);
  });

  it('404s unknown API routes (any method) but serves the app for other GETs', async () => {
    await start();
    // unknown API path / wrong method -> 404, not the SPA
    expect((await fetch(baseUrl + '/api/nope')).status).toBe(404);
    expect((await fetch(baseUrl + CHAT_PATH)).status).toBe(404); // GET on chat
    // unknown non-API GET -> serves the app (SPA fallback)
    expect((await fetch(baseUrl + '/some/route')).status).toBe(200);
    // unknown non-GET -> 404
    expect((await fetch(baseUrl + '/whatever', { method: 'PUT' })).status).toBe(404);
  });

  it('serves the built SPA and hashed assets when a build is present', async () => {
    const staticRoot = makeStaticRoot();
    await start({ staticRoot });

    const index = await fetch(baseUrl + '/');
    expect(await index.text()).toContain('<title>spa</title>');

    const asset = await fetch(baseUrl + '/assets/app-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('text/javascript');
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect(await asset.text()).toBe("console.log('hi')");

    // client-side route -> index.html (SPA fallback)
    const spa = await fetch(baseUrl + '/deep/link');
    expect(await spa.text()).toContain('<title>spa</title>');
  });

  it('blocks path traversal out of the static root', async () => {
    const staticRoot = makeStaticRoot();
    await start({ staticRoot });
    // encoded traversal should not escape the root; falls back to index.html
    const res = await fetch(baseUrl + '/..%2f..%2f..%2fetc%2fpasswd');
    const body = await res.text();
    expect(body).not.toContain('root:');
    expect(body).toContain('<title>spa</title>');
  });

  it('routes posted messages to the responder and streams its output', async () => {
    let received: unknown[] | undefined;
    const respond: ChatResponder = async (res: ServerResponse, messages) => {
      received = messages;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('streamed');
    };
    await start({ respond });

    const messages = [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }];
    const res = await fetch(baseUrl + CHAT_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });

    expect(await res.text()).toBe('streamed');
    expect(received).toEqual(messages);
  });

  it('runs separate chat requests concurrently and keeps their responses isolated', async () => {
    const entered: string[] = [];
    const release = new Map<string, () => void>();
    const respond: ChatResponder = async (res, messages) => {
      const marker = String((messages[0] as { marker?: unknown } | undefined)?.marker);
      entered.push(marker);
      await new Promise<void>((resolve) => release.set(marker, resolve));
      res.end(`response-${marker}`);
    };
    await start({ respond });

    const post = (marker: string) =>
      fetch(baseUrl + CHAT_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ marker }] }),
      }).then((response) => response.text());
    const responseA = post('a');
    const responseB = post('b');

    await expect.poll(() => [...entered].sort()).toEqual(['a', 'b']);
    release.get('b')?.();
    release.get('a')?.();

    await expect(Promise.all([responseA, responseB])).resolves.toEqual([
      'response-a',
      'response-b',
    ]);
  });

  it('defaults to an empty message list on a malformed body', async () => {
    let received: unknown[] | undefined;
    const respond: ChatResponder = async (res, messages) => {
      received = messages;
      res.end('ok');
    };
    await start({ respond });

    await fetch(baseUrl + CHAT_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });

    expect(received).toEqual([]);
  });

  it('persists, lists, resumes, and deletes chat sessions', async () => {
    await start({ sessionStore: tempSessionStore() });
    const url = `${baseUrl}${SESSIONS_PATH}`;

    // Empty to begin with.
    expect(await (await fetch(url)).json()).toEqual([]);

    // Upsert a session (client owns id + messages).
    const messages = [
      {
        id: '1',
        role: 'user',
        parts: [{ type: 'text', text: 'how does auth work' }],
      },
      {
        id: '2',
        role: 'assistant',
        parts: [{ type: 'text', text: 'via tokens' }],
      },
    ];
    const put = await fetch(`${url}/abc123`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'auth', messages }),
    });
    expect(put.status).toBe(200);

    // It shows up in the list with a turn count.
    const list = await (await fetch(url)).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'abc123', title: 'auth', turns: 1 });

    // Resuming returns the messages verbatim.
    const record = await (await fetch(`${url}/abc123`)).json();
    expect(record.messages).toEqual(messages);

    // A branch records parentId; a later PUT without it keeps the lineage.
    const branchPut = await fetch(`${url}/child1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'auth (branch)',
        messages,
        parentId: 'abc123',
      }),
    });
    expect(branchPut.status).toBe(200);
    const branched = await (await fetch(`${url}/child1`)).json();
    expect(branched.parentId).toBe('abc123');

    await fetch(`${url}/child1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'auth (branch)', messages }),
    });
    expect((await (await fetch(`${url}/child1`)).json()).parentId).toBe('abc123');

    const listed = await (await fetch(url)).json();
    expect(listed.find((s: { id: string }) => s.id === 'child1')?.parentId).toBe('abc123');

    // Self-parent and invalid ids are ignored.
    await fetch(`${url}/child1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x', messages, parentId: 'child1' }),
    });
    expect((await (await fetch(`${url}/child1`)).json()).parentId).toBe('abc123');

    // Delete removes it.
    expect((await fetch(`${url}/abc123`, { method: 'DELETE' })).status).toBe(204);
    expect((await fetch(`${url}/child1`, { method: 'DELETE' })).status).toBe(204);
    expect(await (await fetch(url)).json()).toEqual([]);
  });

  it('pins, archives, searches message text across all chats, and preserves flags when prompting again', async () => {
    let prompted: unknown[] | undefined;
    await start({ sessionStore: tempSessionStore(), respond: async (res, messages) => {
      prompted = messages;
      res.end('ok');
    } });
    const url = `${baseUrl}${SESSIONS_PATH}`;
    const put = (id: string, title: string, text: string, answer?: string) => fetch(`${url}/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, messages: [
        { id: 'u', role: 'user', parts: [{ type: 'text', text }] },
        ...(answer ? [{ id: 'a', role: 'assistant', parts: [{ type: 'text', text: answer }] }] : []),
      ] }),
    });
    const patch = (id: string, body: unknown) => fetch(`${url}/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    await put('first', 'First chat', 'Searchable secret phrase');
    await put('second', 'Other chat', 'Something else', 'The unique answer is here');
    expect((await patch('first', { pinned: true, archived: true })).status).toBe(200);
    expect((await patch('second', { pinned: true })).status).toBe(200);

    const results = await (await fetch(`${url}?q=SECRET%20phrase`)).json();
    expect(results.map((item: { id: string }) => item.id)).toEqual(['first']);
    expect(results[0]).toMatchObject({ pinned: true, archived: true });
    const hits = await (await fetch(`${baseUrl}${CHAT_SEARCH_PATH}?q=secret%20phrase`)).json();
    expect(hits).toMatchObject([{ id: 'first', messageId: 'u', role: 'user', archived: true, snippet: 'Searchable secret phrase' }]);
    expect((await (await fetch(`${baseUrl}${CHAT_SEARCH_PATH}?q=other%20chat`)).json())[0]).toMatchObject({ id: 'second', role: 'title' });
    expect((await (await fetch(`${baseUrl}${CHAT_SEARCH_PATH}?q=unique%20answer`)).json())[0]).toMatchObject({ id: 'second', messageId: 'a', role: 'assistant', snippet: 'The unique answer is here' });
    expect((await (await fetch(`${url}?q=other%20chat`)).json()).map((item: { id: string }) => item.id)).toEqual(['second']);
    expect((await (await fetch(url)).json()).map((item: { id: string }) => item.id)).toContain('first');

    const archived = await (await fetch(`${url}/first`)).json();
    expect((await fetch(baseUrl + CHAT_PATH, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: archived.messages }),
    })).status).toBe(200);
    expect(prompted).toEqual(archived.messages);
    await put('first', 'First chat', 'Searchable secret phrase and a new prompt');
    expect(await (await fetch(`${url}/first`)).json()).toMatchObject({ pinned: true, archived: true });

    expect((await patch('first', { pinned: false, archived: false })).status).toBe(200);
    expect(await (await fetch(`${url}/first`)).json()).toMatchObject({ pinned: false, archived: false });
    expect((await patch('missing', { pinned: true })).status).toBe(404);
    expect((await patch('first', { messages: [] })).status).toBe(400);
    expect((await patch('first', { archived: 'yes' })).status).toBe(400);
  });

  it('404s a missing session and 400s a traversal id', async () => {
    await start({ sessionStore: tempSessionStore() });
    expect((await fetch(`${baseUrl}${SESSIONS_PATH}/missing`)).status).toBe(404);
    // encoded `../` id is rejected before it can reach the filesystem
    expect((await fetch(`${baseUrl}${SESSIONS_PATH}/..%2f..%2fetc`)).status).toBe(400);
  });

  it('durably appends editable feedback and queues solved knowledge extraction', async () => {
    const learning = tempLearning();
    await start({ sessionStore: tempSessionStore(), learning });
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Where is X produced?' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Builder.build produces X.' }] },
    ];
    await fetch(`${baseUrl}${SESSIONS_PATH}/conversation1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'X', messages }),
    });
    const solved = await fetch(`${baseUrl}/api/learning/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: 'conversation1',
        message_id: 'a1',
        rating: 3,
        label: 'solved',
      }),
    });
    expect(solved.status).toBe(201);
    const solvedBody = await solved.json();
    expect(solvedBody.jobStatus).toBe('pending');

    const changed = await fetch(`${baseUrl}/api/learning/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: 'conversation1',
        message_id: 'a1',
        rating: 1,
        label: 'partially_useful',
        reason: 'scheduled orders differ',
      }),
    });
    expect(changed.status).toBe(201);
    const events = await learning.store.events();
    const feedback = events.flatMap((event) =>
      event.type === 'feedback_recorded' ? [event.feedback] : [],
    );
    expect(feedback).toHaveLength(2);
    expect(feedback[1].supersedes_feedback_id).toBe(feedback[0].feedback_id);

    const params = new URLSearchParams({ conversation_id: 'conversation1', message_id: 'a1' });
    const current = await (await fetch(`${baseUrl}/api/learning/feedback?${params}`)).json();
    expect(current.label).toBe('partially_useful');
  });
});
