import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CanvasStore } from '../../core/canvas/store.js';
import { closeCanvasStreams } from './stream.js';
import { routeCanvas } from './routes.js';

let server: Server;
let root: string;
let base: string;
let store: CanvasStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'canvas-http-'));
  store = new CanvasStore(root, '/canvas');
  server = createServer((req, res) => void routeCanvas(req, res, store, new URL(req.url!, 'http://localhost')));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});

async function post(path: string, body: unknown, method = 'POST') {
  return fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

it('is opt-in, persists settings and rejects cross-origin or malformed requests', async () => {
  expect((await fetch(base + '/api/canvas/scene?chat=one')).status).toBe(403);
  expect((await post('/api/settings/canvas', { enabled: true }, 'PUT')).status).toBe(200);
  expect(await new CanvasStore(root, '/canvas').available()).toBe(true);
  expect((await fetch(base + '/api/canvas/scene?chat=../bad')).status).toBe(400);
  expect((await fetch(base + '/api/settings/canvas', {
    method: 'PUT', headers: { Origin: 'https://evil.test', 'Content-Type': 'application/json' },
    body: '{"enabled":false}',
  })).status).toBe(403);
  expect((await fetch(base + '/api/canvas/scene?chat=one', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: '{broken' })).status).toBe(400);
});

it('streams only this chat, reads browser edits and rejects stale or cross-chat writes', async () => {
  await store.configure(true);
  const chat = store.forChat('one');
  await chat.ensure();
  const controller = new AbortController();
  const response = await fetch(base + '/api/canvas/events?chat=one', { signal: controller.signal });
  const reader = response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('"name":"chat-one"');

  await chat.change('add', { elements: [{ id: 'api', type: 'rectangle', text: 'API' }] });
  let event = '';
  while (!event.includes('"id":"api"')) event += new TextDecoder().decode((await reader.read()).value);
  expect(event).toContain('"revision":1');

  const scene = await (await fetch(base + '/api/canvas/scene?chat=one')).json();
  scene.elements.find((element: { type: string }) => element.type === 'text').text = 'Browser edit';
  expect((await post('/api/canvas/scene?chat=one', scene)).status).toBe(200);
  expect(chat.describe(await chat.current()).elements[0]!.text).toBe('Browser edit');
  expect((await post('/api/canvas/scene?chat=one', scene)).status).toBe(409);

  const other = store.forChat('two');
  await other.ensure();
  await other.change('add', { elements: [{ id: 'private', type: 'rectangle' }] });
  expect((await post('/api/canvas/scene?chat=two', scene)).status).toBe(409);
  expect((await fetch(base + '/api/canvas/scene')).status).toBe(400);
  expect((await fetch(base + '/api/canvas/list?chat=one')).status).toBe(404);
  event = new TextDecoder().decode((await reader.read()).value);
  expect(event).not.toContain('private');
  controller.abort();
});

it('ends SSE connections during harness shutdown', async () => {
  await store.configure(true);
  await store.forChat('shutdown').ensure();
  const response = await fetch(base + '/api/canvas/events?chat=shutdown');
  const reader = response.body!.getReader();
  await reader.read();
  closeCanvasStreams(store);

  expect((await reader.read()).done).toBe(true);
});
