import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { memorySourceState } from '../memory-source.js';
import type { KnowledgeArtifact } from '../types.js';
import { canonicalArtifact, canonicalRef } from './canonical.js';

const team = '/work/team-a';

const repositories = [{ path: team }, { path: `${team}/api` }, { path: `${team}/apiary-docs` }];

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it('moves a citation into the repository that now holds the file', () => {
  expect(canonicalRef({ repo: team, path: 'api/src/x.ts', symbol: 'x' }, repositories)).toEqual({
    repo: `${team}/api`,
    path: 'src/x.ts',
    symbol: 'x',
  });
});

it('keeps citations that already name the innermost repository', () => {
  const inRepo = { repo: `${team}/api`, path: 'src/x.ts' };
  const loose = { repo: team, path: 'README.md' };
  const prefixOnly = { repo: team, path: 'apiary/notes.md' };

  expect(canonicalRef(inRepo, repositories)).toEqual(inRepo);
  expect(canonicalRef(loose, repositories)).toEqual(loose);
  expect(canonicalRef(prefixOnly, repositories)).toEqual(prefixOnly);
});

it('rewrites saved file hashes with their citations', () => {
  const artifact = {
    source_refs: [{ repo: team, path: 'api/src/x.ts' }],
    source_hashes: { [`${team}\0api/src/x.ts`]: 'h1', [`${team}\0README.md`]: 'h2' },
  } as unknown as KnowledgeArtifact;

  const moved = canonicalArtifact(artifact, repositories);

  expect(moved.source_refs).toEqual([{ repo: `${team}/api`, path: 'src/x.ts' }]);
  expect(moved.source_hashes).toEqual({ [`${team}/api\0src/x.ts`]: 'h1', [`${team}\0README.md`]: 'h2' });
});

it('keeps a finding fresh when its project is split into repositories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codeberg-split-'));
  dirs.push(root);

  await mkdir(join(root, 'api', 'src'), { recursive: true });
  await writeFile(join(root, 'api', 'src', 'x.ts'), 'export const x = 1;\n');

  const before = [{ path: root }];
  const after = [{ path: root }, { path: join(root, 'api') }];

  const saved = await memorySourceState(
    { repositories: [], source_commits: {}, source_refs: [{ repo: root, path: 'api/src/x.ts' }] } as unknown as KnowledgeArtifact,
    before,
  );

  const artifact = {
    repositories: [],
    source_commits: {},
    source_refs: [{ repo: root, path: 'api/src/x.ts' }],
    source_hashes: saved.hashes,
  } as unknown as KnowledgeArtifact;

  expect((await memorySourceState(artifact, before)).fresh).toBe(true);

  const split = await memorySourceState(artifact, after);

  expect(split.fresh).toBe(true);
  expect(split.observations[0]).toMatchObject({ repo: join(root, 'api'), path: 'src/x.ts' });
  expect(Object.keys(split.hashes)).toEqual([`${join(root, 'api')}\0src/x.ts`]);
});
