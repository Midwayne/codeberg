import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { writeAtomic } from './fs.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('removes an atomic-write temp file if publishing the write fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codeberg-atomic-'));
  roots.push(root);
  const target = join(root, 'job.json');
  await mkdir(target);

  await expect(writeAtomic(target, '{}')).rejects.toThrow();
  expect(await readdir(root)).toEqual(['job.json']);
});
