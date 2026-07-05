import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CHAT_PATH,
  COMMANDS_PATH,
  META_PATH,
  SESSIONS_PATH,
  createWebServer,
  type ChatResponder,
  type WebServerOptions,
} from './server.js';
import { WebSessionStore } from './sessions.js';

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

  it('returns model/daemon metadata for the title bar', async () => {
    await start({ title: 'codeberg · m · d' });
    const res = await fetch(baseUrl + META_PATH);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ title: 'codeberg · m · d' });
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

    // Delete removes it.
    expect((await fetch(`${url}/abc123`, { method: 'DELETE' })).status).toBe(204);
    expect(await (await fetch(url)).json()).toEqual([]);
  });

  it('404s a missing session and 400s a traversal id', async () => {
    await start({ sessionStore: tempSessionStore() });
    expect((await fetch(`${baseUrl}${SESSIONS_PATH}/missing`)).status).toBe(404);
    // encoded `../` id is rejected before it can reach the filesystem
    expect((await fetch(`${baseUrl}${SESSIONS_PATH}/..%2f..%2fetc`)).status).toBe(400);
  });
});
