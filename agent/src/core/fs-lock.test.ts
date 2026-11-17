import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { acquireFileLock, withFileLock, type FileLockOptions } from './fs-lock.js';

const options: FileLockOptions = {
  timeoutMs: 0,
  intervalMs: 1,
  staleMs: 60_000,
  busy: () => new Error('busy'),
};

let dir: string | undefined;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function lockPath(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'fs-lock-'));

  return join(dir, '.lock');
}

describe('file locks', () => {
  it('records the owner and releases after the action', async () => {
    const path = await lockPath();

    const owner = await withFileLock(path, options, () => readFile(path, 'utf8'));

    expect(owner).toBe(String(process.pid));
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a lock held by a live process', async () => {
    const path = await lockPath();
    const release = await acquireFileLock(path, options);

    await expect(acquireFileLock(path, options)).rejects.toThrow('busy');

    await release();
  });

  it('waits for a live owner until the timeout', async () => {
    const path = await lockPath();
    const release = await acquireFileLock(path, options);
    setTimeout(() => void release(), 20);

    const second = await acquireFileLock(path, { ...options, timeoutMs: 1_000 });

    await second();
  });

  it('recovers a lock whose owner has exited', async () => {
    const path = await lockPath();
    await writeFile(path, '2147483646');

    const release = await acquireFileLock(path, options);

    expect(await readFile(path, 'utf8')).toBe(String(process.pid));
    await release();
  });

  it('keeps an ownerless lock until it is stale', async () => {
    const path = await lockPath();
    await writeFile(path, '');

    await expect(acquireFileLock(path, options)).rejects.toThrow('busy');

    const release = await acquireFileLock(path, { ...options, staleMs: -1 });
    await release();
  });
});
