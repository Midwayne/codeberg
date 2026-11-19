import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import type { ProjectCatalog } from '../core/projects.js';
import { createProjectRequestHandler } from './projects.js';

const existing = { id: 'p-0123456789abcdef', name: 'Team A', roots: [{ key: 'team-a', root: '/work/team-a' }] };

const catalog: ProjectCatalog = { version: 1, defaultId: existing.id, legacyId: existing.id, projects: [existing] };

const servers: Server[] = [];

const dirs: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }

  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));

  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

it('names the project that already uses a directory instead of adding another', async () => {
  const home = await mkdtemp(join(tmpdir(), 'project-add-'));
  dirs.push(home);

  const daemonUrl = await listen(createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'POST') {
      res.writeHead(409);
      res.end(JSON.stringify({ message: '"Team A" already uses this directory', project: existing }));
      return;
    }

    res.end(JSON.stringify(catalog));
  }));

  const base = await listen(createServer(createProjectRequestHandler({
    catalog,
    home,
    daemonUrl,
    build: async () => (_req, res) => res.end('handler'),
  })));

  const response = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root: '/work/team-a' }),
  });

  expect(response.status).toBe(409);

  const body = await response.json();

  expect(body.message).toBe('"Team A" already uses this directory');
  expect(body.project).toMatchObject({ id: existing.id, name: 'Team A' });
  expect(body.project.configDirectory).toBe(join(home, 'projects', existing.id));
});
