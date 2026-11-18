import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { LearningService } from '../../core/learning/service.js';
import { routeMemory } from './memory-routes.js';

let server: Server | undefined;
let learning: LearningService | undefined;
let root = '';

afterEach(async () => {
  learning?.stop();
  await learning?.waitForCurrent();

  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));

  if (root) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  root = await mkdtemp(join(tmpdir(), 'memory-http-'));
  learning = new LearningService({ root, repositories: async () => [] });

  server = createServer((req, res) => {
    void routeMemory(req, res, learning!, new URL(req.url!, 'http://localhost'));
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));

  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/learning/memory`;
}

it('lists saved memory and removes a profile note', async () => {
  const url = await fixture();

  await learning!.profile.update(() => [
    {
      id: 'profile-abc',
      kind: 'preference',
      statement: 'Prefers tables.',
      evidence: 'use a table',
      source_interactions: ['i1'],
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    },
  ]);

  const dashboard = await (await fetch(url)).json();

  expect(dashboard).toMatchObject({ knowledge: [], pending: 0, errors: [] });
  expect(dashboard.profile.map((note: { id: string }) => note.id)).toEqual(['profile-abc']);

  expect((await fetch(`${url}/profile/profile-abc`, { method: 'DELETE' })).status).toBe(200);
  expect((await fetch(`${url}/profile/profile-abc`, { method: 'DELETE' })).status).toBe(404);
  expect((await fetch(`${url}/profile/../settings`, { method: 'DELETE' })).status).toBe(404);
  expect((await fetch(url, { method: 'POST' })).status).toBe(405);

  expect(await learning!.profile.list()).toEqual([]);
});
