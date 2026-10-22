import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { UIMessageChunk } from 'ai';
import { afterEach, expect, it, vi } from 'vitest';
import { createWebServer } from '../server.js';
import { WebSessionStore } from '../sessions/store.js';
import type { ChatGenerator } from './types.js';

let server: Server;
let directory: string;
let base: string;
let sink: ReadableStreamDefaultController<UIMessageChunk>;
const messages = [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Where is auth?' }] }];

async function setup() {
  directory = await mkdtemp(join(tmpdir(), 'codeberg-runs-http-'));
  const generate = vi.fn<ChatGenerator>(async () => ({ stream: new ReadableStream({
    start(controller) { sink = controller; },
  }) }));
  server = createWebServer({ title: 'test', sessionStore: new WebSessionStore(directory), generate });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return generate;
}

function submit(requestId = 'request') {
  return fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'chat', requestId, messages }) });
}

afterEach(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
});

it('reconnects over HTTP without executing the search twice, and guards cleanup after disconnect', async () => {
  const generate = await setup();
  const first = await submit();
  expect(first.headers.get('x-codeberg-run')).toMatch(/^[a-f0-9]{32}$/);
  await first.body!.cancel();
  const cleanup = await fetch(`${base}/api/settings/cleanup`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categories: ['chats'], olderThanDays: 0 }) });
  expect(cleanup.status).toBe(409);

  const replay = await fetch(`${base}/api/chat/chat/stream`);
  sink.enqueue({ type: 'start', messageId: 'a1' });
  sink.enqueue({ type: 'text-start', id: 'text' });
  sink.enqueue({ type: 'text-delta', id: 'text', delta: 'src/auth.ts' });
  sink.enqueue({ type: 'text-end', id: 'text' });
  sink.enqueue({ type: 'finish', finishReason: 'stop' });
  sink.close();
  const body = await replay.text();
  expect(body).toContain('src/auth.ts');
  expect(body).toContain('[DONE]');
  expect(generate).toHaveBeenCalledOnce();
  const saved = await (await fetch(`${base}/api/sessions/chat`)).json();
  expect(saved.messages).toHaveLength(2);
  const duplicate = await submit();
  expect(duplicate.headers.get('x-codeberg-run')).toBe(first.headers.get('x-codeberg-run'));
  await duplicate.text();
  expect(generate).toHaveBeenCalledOnce();
});

it('offers explicit Stop and rejects a second tab submission and cross-origin stop', async () => {
  const generate = await setup();
  const first = await submit();
  const runId = first.headers.get('x-codeberg-run');
  expect((await submit('other-tab')).status).toBe(409);
  const url = `${base}/api/chat/chat/stop`;
  const body = JSON.stringify({ runId });
  expect((await fetch(url, { method: 'POST', headers: { Origin: 'https://elsewhere.test',
    'Content-Type': 'application/json' }, body })).status).toBe(403);
  expect((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status).toBe(200);
  await first.text();
  const info = await (await fetch(`${base}/api/chat/chat/run`)).json();
  expect(info.status).toBe('stopped');
  expect(generate).toHaveBeenCalledOnce();
});

it('looks up the requested submission without falling back to the latest chat run', async () => {
  const generate = await setup();
  const response = await submit();
  sink.enqueue({ type: 'start', messageId: 'answer' });
  sink.enqueue({ type: 'finish' });
  sink.close();
  await response.text();

  const existing = await fetch(`${base}/api/chat/chat/run?requestId=request`);
  expect(existing.status).toBe(200);
  expect(await existing.json()).toMatchObject({ requestId: 'request', status: 'completed' });
  expect((await fetch(`${base}/api/chat/chat/run?requestId=not-admitted`)).status).toBe(404);
  expect(generate).toHaveBeenCalledOnce();
});

it('includes durable journals in cleanup size and removes them with the chat', async () => {
  await setup();
  const response = await submit();
  sink.enqueue({ type: 'start', messageId: 'a1' });
  sink.enqueue({ type: 'finish', finishReason: 'stop' });
  sink.close();
  await response.text();
  const preview = await (await fetch(`${base}/api/settings/cleanup?olderThanDays=0`)).json();
  const chats = preview.categories.find((row: any) => row.category === 'chats');
  expect(chats.bytes).toBeGreaterThan(500);
  const cleanup = await (await fetch(`${base}/api/settings/cleanup`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categories: ['chats'], olderThanDays: 0 }) })).json();
  expect(cleanup.bytesFreed).toBe(chats.bytes);
  expect(cleanup.deletedChatIds).toEqual(['chat']);
  const { stat } = await import('node:fs/promises');
  await expect(stat(join(directory, '.runs', 'chat'))).rejects.toMatchObject({ code: 'ENOENT' });
});
