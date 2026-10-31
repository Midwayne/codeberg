import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { createProjectRequestHandler, type ProjectRouterOptions } from '../projects.js';
import type { SetupStatus } from './status.js';

async function getSetup(setup?: ProjectRouterOptions['setup']): Promise<{ status: number; body: unknown }> {
  const home = await mkdtemp(join(tmpdir(), 'codeberg-setup-route-'));
  await writeFile(join(home, 'index.html'), '<html></html>');

  let builds = 0;
  const server = createServer(createProjectRequestHandler({
    catalog: { version: 1, defaultId: '', legacyId: '', projects: [] },
    staticRoot: home,
    daemonUrl: 'http://unused',
    setup,
    build: async () => {
      builds++;
      throw new Error('Setup status must not build a project');
    },
  }));

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${port}/api/setup`);

    expect(builds).toBe(0);

    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  }
}

it('reports setup status without a project', async () => {
  const required: SetupStatus = {
    ready: false,
    reason: 'missing-credentials',
    detail: 'no model',
    providers: [{ provider: 'openai', label: 'OpenAI', missing: ['OPENAI_API_KEY'] }],
  };

  expect(await getSetup(async () => required)).toEqual({ status: 200, body: required });
});

it('treats a server without a setup check as ready', async () => {
  expect(await getSetup()).toEqual({ status: 200, body: { ready: true } });
});
