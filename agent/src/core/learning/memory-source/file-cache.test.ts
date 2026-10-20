import { mkdtemp, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { readSource } from './reading.js';

vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>();
  return { ...fs, readFile: vi.fn(fs.readFile) };
});

const roots: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.clearAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('expires cached contents after five minutes even when metadata is unchanged', async () => {
  const { root, ref } = await fixture();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
  try {
    await readSource(ref, [{ path: root }]);
    clock.mockReturnValue(301001);
    await readSource(ref, [{ path: root }]);
    expect(readFile).toHaveBeenCalledTimes(2);
  } finally {
    clock.mockRestore();
  }
});

it('evicts old contents to keep retained source text bounded', async () => {
  const { root, path, ref } = await fixture();
  const repos = [{ path: root }];
  await writeFile(path, 'x'.repeat(900000));
  await readSource(ref, repos);
  for (let i = 0; i < 6; i++) {
    await writeFile(join(root, `${i}.ts`), 'y'.repeat(900000));
    await readSource({ repo: root, path: `${i}.ts` }, repos);
  }
  vi.mocked(readFile).mockClear();
  await readSource(ref, repos);
  expect(readFile).toHaveBeenCalledTimes(1);
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'source-cache-'));
  roots.push(root);
  const path = join(root, 'source.ts');
  await writeFile(path, 'export const value = "before";');
  return { root, path, ref: { repo: root, path: 'source.ts' } };
}

it('reuses source bytes across observations while refreshing commit metadata', async () => {
  const { root, ref } = await fixture();
  const first = await readSource(ref, [{ path: root, commit: 'one' }]);
  const second = await readSource({ ...ref, symbol: 'value' }, [{ path: root, commit: 'two' }]);

  expect(first.hash).toBe(second.hash);
  expect(second.commit).toBe('two');
  expect(second.symbol).toBe('value');
  expect(readFile).toHaveBeenCalledTimes(1);
});

it('detects same-size edits with restored mtime, atomic replacement, and removal', async () => {
  const { root, path, ref } = await fixture();
  const repos = [{ path: root }];
  const first = await readSource(ref, repos);
  const info = await stat(path);
  await writeFile(path, 'export const value = "after!";');
  await utimes(path, info.atime, info.mtime);
  const edited = await readSource(ref, repos);
  expect(edited.hash).not.toBe(first.hash);
  expect(edited.excerpt).toContain('after!');

  await writeFile(`${path}.tmp`, 'export const value = "newest";');
  await rename(`${path}.tmp`, path);
  expect((await readSource(ref, repos)).excerpt).toContain('newest');
  await rm(path);
  expect((await readSource(ref, repos)).unavailable).toBeDefined();
});
