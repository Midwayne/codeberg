import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { LearningService } from '../core/learning/service.js';
import { routeLearning } from './learning-routes.js';
import { WebSessionStore } from './sessions/store.js';

let server: Server | undefined;
let root = '';

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));

  if (root) await rm(root, { recursive: true, force: true });
});

it('exposes saved automatic reports and pending jobs through read-only learning routes', async () => {
  root = await mkdtemp(join(tmpdir(), 'evaluation-http-'));
  const learning = new LearningService({ root });
  const id = `evaluation-${'a'.repeat(24)}`;
  await learning.evaluationReports.save({
    id,
    harness_version: 1,
    example_id: 'example-id',
    source_revision: 'revision',
    repositories: [],
    configuration: {
      candidate: { key: 'chat', model: 'test:chat', effort: 'none', contextWindow: 32_000 },
      judge: { key: 'judge', model: 'test:judge', effort: 'none', contextWindow: 32_000 },
    },
    updated_at: new Date().toISOString(),
    status: 'completed',
  });
  await learning.queue.enqueueEvaluation(`evaluation-${'b'.repeat(24)}`);
  server = createServer((req, res) => {
    void routeLearning(
      req,
      res,
      learning,
      new WebSessionStore(join(root, 'sessions')),
      new URL(req.url!, 'http://localhost'),
    ).catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/learning/evaluations`;
  const response = await fetch(url);
  const dashboard = await response.json();

  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(dashboard.reports).toMatchObject([{ id, status: 'completed' }]);
  expect(dashboard.jobs).toMatchObject([{ type: 'evaluate_output' }]);
  expect((await fetch(`${url}/${id}`)).status).toBe(200);
  expect((await fetch(`${url}/evaluation-${'c'.repeat(24)}`)).status).toBe(404);
  expect((await fetch(`${url}/invalid`)).status).toBe(400);
  expect((await fetch(url, { method: 'POST' })).status).toBe(405);
});
