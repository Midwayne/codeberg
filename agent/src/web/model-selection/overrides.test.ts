import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { resolveOverrides } from './overrides.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it('reads the instructions file and keeps the other overrides', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codeberg-overrides-'));
  dirs.push(dir);
  const file = join(dir, 'small.md');
  await writeFile(file, 'Use grep first.\n');

  expect(await resolveOverrides({ tier: 'light', toolOutputLimit: 4000, instructionsFile: file })).toEqual({
    tier: 'light',
    toolOutputLimit: 4000,
    instructions: 'Use grep first.\n',
  });
});

it('returns undefined without overrides and names a missing instructions file', async () => {
  expect(await resolveOverrides(undefined)).toBeUndefined();
  await expect(resolveOverrides({ instructionsFile: '/nonexistent/codeberg.md' })).rejects.toThrow(/codeberg\.md/);
});

it('rejects an empty instructions file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codeberg-overrides-'));
  dirs.push(dir);
  const file = join(dir, 'empty.md');
  await writeFile(file, '  \n');

  await expect(resolveOverrides({ instructionsFile: file })).rejects.toThrow(/empty/);
});
