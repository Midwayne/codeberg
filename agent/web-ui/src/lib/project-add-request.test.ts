import { afterEach, expect, it, vi } from 'vitest';

import { requestAddProject } from './project-add-request';

const project = { id: 'p-1', name: 'Team A', roots: [{ key: 'team-a', root: '/work/team-a' }] };

afterEach(() => vi.unstubAllGlobals());

function respond(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

it('returns a newly added project', async () => {
  respond(201, project);

  await expect(requestAddProject('', '/work/team-a')).resolves.toEqual({ kind: 'added', project });
});

it('returns the project that already uses the directory', async () => {
  respond(409, { message: '"Team A" already uses this directory', project });

  await expect(requestAddProject('', '/work/team-a')).resolves.toEqual({ kind: 'existing', project });
});

it('reports other failures as errors', async () => {
  respond(400, { message: 'choose an existing directory' });

  await expect(requestAddProject('', '/missing')).rejects.toThrow('choose an existing directory');
});
