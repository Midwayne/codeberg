import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createProjectRequestHandler } from './projects.js';

it('serves deep documentation URLs without requiring or initializing a project', async () => {
  const home = await mkdtemp(join(tmpdir(), 'codeberg-docs-route-'));
  await writeFile(join(home, 'index.html'), '<html>Codeberg documentation shell</html>');
  let builds = 0;
  const server = createServer(createProjectRequestHandler({
    catalog: { version: 1, defaultId: '', legacyId: '', projects: [] },
    staticRoot: home,
    daemonUrl: 'http://unused',
    build: async () => {
      builds++;
      throw new Error('Docs must not build a project');
    },
  }));

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${address.port}/docs/models`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Codeberg documentation shell');
    expect(builds).toBe(0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  }
});
