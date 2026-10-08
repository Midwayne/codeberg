import { createServer, type Server } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import type { ProjectCatalog } from '../core/projects.js';
import { createProjectRequestHandler } from './projects.js';

const initial: ProjectCatalog = {
  version: 1,
  defaultId: 'p-0123456789abcdef',
  legacyId: 'p-0123456789abcdef',
  projects: [{ id: 'p-0123456789abcdef', name: 'A', roots: [{ key: 'a', root: '/a' }] }],
};
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => {
    server.closeAllConnections();
    server.close(() => done());
  })));
});

async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));

  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

it.each(['index', 'all'])('deletes with %s mode, retires cached handlers, and rebuilds on re-add', async (mode) => {
  let catalog = structuredClone(initial);
  const calls: string[] = [];
  const daemonUrl = await listen(createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'DELETE') {
      let raw = '';
      for await (const part of req) raw += part;
      calls.push(JSON.parse(raw).mode);
      catalog = { ...catalog, defaultId: '', projects: [] };
    }
    res.end(JSON.stringify(catalog));
  }));
  const dispose = vi.fn(async () => undefined);
  const build = vi.fn(async () => (_req: unknown, res: import('node:http').ServerResponse) => res.end('handler'));
  const base = await listen(createServer(createProjectRequestHandler({ catalog: initial, daemonUrl, build, dispose })));
  await fetch(`${base}/api/meta`);
  const result = await fetch(`${base}/api/projects/${initial.defaultId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });

  expect(result.status).toBe(200);
  expect((await result.json()).projects).toEqual([]);
  expect(calls).toEqual([mode]);
  expect(dispose).toHaveBeenCalledWith(initial.defaultId);
  expect((await fetch(`${base}/api/meta`)).status).toBe(404);
  catalog = structuredClone(initial);
  await fetch(`${base}/api/projects`);
  await fetch(`${base}/api/meta`);
  expect(build).toHaveBeenCalledTimes(2);
});

it('rejects invalid, cross-origin and busy deletions without calling the daemon mutation', async () => {
  let mutations = 0;
  const daemonUrl = await listen(createServer((req, res) => {
    if (req.method === 'DELETE') mutations++;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(initial));
  }));
  const base = await listen(createServer(createProjectRequestHandler({
    catalog: initial,
    daemonUrl,
    build: async () => (_req, res) => res.end(),
    dispose: async () => { throw new Error('Project is busy. Try again after background jobs finish.'); },
  })));
  const url = `${base}/api/projects/${initial.defaultId}`;
  const headers = { 'Content-Type': 'application/json' };
  expect((await fetch(url, { method: 'DELETE', headers, body: '{}' })).status).toBe(400);
  expect((await fetch(url, { method: 'DELETE', headers: { ...headers, Origin: 'https://other.example' }, body: '{"mode":"all"}' })).status).toBe(403);
  expect((await fetch(url, { method: 'DELETE', headers, body: '{"mode":"all"}' })).status).toBe(409);
  expect(mutations).toBe(0);
});

it('serves the app after deleting the last project without initializing project storage', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'empty-project-page-'));
  try {
    await writeFile(join(root, 'index.html'), '<html>Project shell</html>');
    const build = vi.fn();
    const base = await listen(createServer(createProjectRequestHandler({
      catalog: { ...initial, defaultId: '', projects: [] },
      daemonUrl: 'http://unused',
      staticRoot: root,
      build,
    })));
    expect(await (await fetch(base)).text()).toContain('Project shell');
    expect((await fetch(`${base}/api/meta`)).status).toBe(404);
    expect(build).not.toHaveBeenCalled();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('blocks deletion until routing finishes even after the browser disconnects', async () => {
  const daemonUrl = await listen(createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(initial));
  }));
  let release!: () => void;
  const routing = new Promise<void>((done) => { release = done; });
  const base = await listen(createServer(createProjectRequestHandler({
    catalog: initial,
    daemonUrl,
    build: async () => async (_req, res) => {
      res.end('early response');
      await routing;
    },
  })));
  await fetch(`${base}/api/meta`);
  const result = await fetch(`${base}/api/projects/${initial.defaultId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: '{"mode":"all"}',
  });

  expect(result.status).toBe(409);
  release();
});
