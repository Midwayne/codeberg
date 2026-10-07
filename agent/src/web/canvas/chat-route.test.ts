import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { CanvasStore } from '../../core/canvas/store.js';
import { canvasToolSource } from '../../core/canvas/tools.js';
import { routeChat } from '../chat-routes.js';
import { routeSessions } from '../sessions/routes.js';
import { WebSessionStore } from '../sessions/store.js';
import { sendJson } from '../http.js';

it('binds pooled tool execution to the submitted chat ID and copies drawings through the session branch route', async () => {
  const root = await mkdtemp(join(tmpdir(), 'canvas-route-'));
  const store = new CanvasStore(join(root, 'canvas'), '/canvas', true);
  const sessions = new WebSessionStore(join(root, 'sessions'));
  const tools = await canvasToolSource(store).tools();
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/api/sessions/')) {
      void routeSessions(req, res, sessions, req.url, undefined, store);
      return;
    }
    void routeChat(req, res, undefined, async (response) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const result = await tools.canvas_add!.execute!({ revision: 0, elements: [{ id: 'api', type: 'rectangle', text: 'API' }] },
        { toolCallId: 'draw', messages: [], context: undefined });
      sendJson(response, 200, result);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (path: string, body: unknown, method = 'POST') => fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    const results = await Promise.all(['one', 'two'].map(async (id) => (await request('/api/chat', { id, messages: [] })).json()));
    expect(results.map((result) => result.chatId)).toEqual(['one', 'two']);
    expect((await request('/api/chat', { id: '../escape' })).status).toBe(400);
    expect(await (await request('/api/chat', {})).json()).toHaveProperty('error');

    await request('/api/sessions/one', { messages: [], title: 'Parent' }, 'PUT');
    await request('/api/sessions/child', { messages: [], parentId: 'one' }, 'PUT');
    expect(store.describe(await store.forChat('child').current()).elements[0]).toMatchObject({ id: 'api', text: 'API' });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
