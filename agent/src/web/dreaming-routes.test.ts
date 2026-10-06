import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { LearningService } from '../core/learning/service.js';
import { routeDreaming } from './dreaming-routes.js';

let server: Server | undefined;
let learning: LearningService | undefined;
let root = '';
afterEach(async () => {
  learning?.stop(); await learning?.waitForCurrent();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  if (root) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  root = await mkdtemp(join(tmpdir(), 'dreaming-http-'));
  learning = new LearningService({ root, repositories: async () => [], generator: { generate: async () => '{"summary":"No changes","merges":[],"links":[]}' } });
  await learning.initialize();
  server = createServer((req, res) => { void routeDreaming(req, res, learning!, new URL(req.url!, 'http://localhost')).catch(() => { res.writeHead(500); res.end(); }); });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/learning/dreaming`;
}
it('queues a report, exposes reviewable history, and validates decisions', async () => {
  const url = await fixture();
  const post = (path: string, body: unknown) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const response = await post('', {}); expect(response.status).toBe(202);
  const job = await response.json(); await learning!.waitForCurrent();
  const dashboard = await (await fetch(url)).json();
  expect(dashboard.reports).toHaveLength(1);
  expect(dashboard.reports[0].id).toBe(job.interaction_id);
  expect(dashboard.jobs).toEqual([]);
  expect((await post(`/${job.interaction_id}`, { action: 'apply' })).status).toBe(409);
  expect((await post(`/${job.interaction_id}`, { action: 'dismiss' })).status).toBe(200);
  expect((await (await fetch(`${url}/${job.interaction_id}`)).json()).status).toBe('dismissed');
  expect((await post(`/${job.interaction_id}`, { action: 'undo' })).status).toBe(409);
  expect((await post(`/${job.interaction_id}`, { action: 'invented' })).status).toBe(400);
  expect((await fetch(`${url}/bad-id`)).status).toBe(400);
  expect((await fetch(url, { method: 'DELETE' })).status).toBe(405);
});
it('rejects cross-origin writes and paused requests, while keeping reports readable', async () => {
  const url = await fixture();
  expect((await fetch(url, { method: 'POST', headers: { Origin: 'https://elsewhere.example', 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(403);
  expect((await fetch(url, { method: 'POST', body: '{}' })).status).toBe(415);
  await learning!.updateSettings({ enabled: false });
  expect((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(409);
  expect((await fetch(url)).status).toBe(200);
});
