import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import type { Project, ProjectCatalog } from '../core/projects.js';
import { createProjectRequestHandler } from './projects.js';

const team: Project = { id: 'p-0123456789abcdef', name: 'Team A', roots: [{ key: 'team-a', root: '/work/team-a' }] };

const split: Project = { ...team, roots: [...team.roots, { key: 'api', root: '/work/team-a/api' }] };

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

async function proxy(daemon: (url: string, method: string) => unknown) {
  const home = await mkdtemp(join(tmpdir(), 'project-rescan-'));
  dirs.push(home);

  const calls: string[] = [];
  const daemonUrl = await listen(createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(daemon(req.url ?? '', req.method ?? 'GET')));
  }));

  const built: string[][] = [];
  const disposed: string[] = [];
  const catalog: ProjectCatalog = { version: 1, defaultId: team.id, legacyId: team.id, projects: [team] };

  const base = await listen(createServer(createProjectRequestHandler({
    catalog,
    home,
    daemonUrl,
    dispose: async (id) => void disposed.push(id),
    build: async (project) => {
      built.push(project.roots.map((root) => root.key));

      return (_req, res) => res.end('handler');
    },
  })));

  return { base, calls, built, disposed };
}

it('previews the repositories in a directory through the daemon', async () => {
  const preview = { directory: '/work/team-a', repositories: [{ key: 'api', path: 'api', marker: '.git' }] };
  const { base, calls } = await proxy(() => preview);

  const response = await fetch(`${base}/api/projects/discover?root=${encodeURIComponent('/work/team-a')}`);

  expect(await response.json()).toEqual(preview);
  expect(calls).toEqual([`GET /projects/discover?root=${encodeURIComponent('/work/team-a')}`]);
});

it('rescans a project and rebuilds its handler over the new roots', async () => {
  let current = team;
  const { base, built, disposed } = await proxy((url, method) => {
    if (method === 'POST') current = split;

    return url === '/projects' ? { version: 1, defaultId: team.id, legacyId: team.id, projects: [current] } : current;
  });

  await fetch(`${base}/api/meta`, { headers: { 'X-Codeberg-Project': team.id } });

  const response = await fetch(`${base}/api/projects/${team.id}/rescan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ignored: [] }),
  });

  expect(response.status).toBe(200);
  expect((await response.json()).roots).toHaveLength(2);
  expect(disposed).toEqual([team.id]);

  await fetch(`${base}/api/meta`, { headers: { 'X-Codeberg-Project': team.id } });

  expect(built).toEqual([['team-a'], ['team-a', 'api']]);
});
