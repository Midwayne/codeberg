import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { readRecordFiles, writeAtomic } from './fs.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('skips a bad record and a missing directory without dropping the readable files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codeberg-records-'));
  roots.push(root);
  await writeAtomic(join(root, 'b.json'), '{"id":"b"}\n');
  await writeAtomic(join(root, 'a.json'), '{"id":"a"}\n');
  await writeAtomic(join(root, 'bad.json'), '{oops\n');
  await writeAtomic(join(root, 'note.txt'), 'skip\n');

  const read = (dir: string, sort = false) =>
    readRecordFiles(dir, (name) => name.endsWith('.json'), (raw) => JSON.parse(raw) as { id: string }, sort);

  expect(await read(root)).toEqual(expect.arrayContaining([{ id: 'a' }, { id: 'b' }]));
  expect(await read(root)).toHaveLength(2);
  expect(await read(root, true)).toEqual([{ id: 'a' }, { id: 'b' }]);
  expect(await read(join(root, 'missing'))).toEqual([]);
});

it('removes an atomic-write temp file if publishing the write fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codeberg-atomic-'));
  roots.push(root);
  const target = join(root, 'job.json');
  await mkdir(target);

  await expect(writeAtomic(target, '{}')).rejects.toThrow();
  expect(await readdir(root)).toEqual(['job.json']);
});
