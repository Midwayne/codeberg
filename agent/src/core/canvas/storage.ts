import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { CanvasError } from './types.js';

export async function readData(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;

    const reason = error instanceof SyntaxError ? 'invalid JSON' : (error as NodeJS.ErrnoException).code ?? 'unreadable file';
    throw new CanvasError(`Cannot read canvas data: ${reason}`, 503);
  }
}

export async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify(value));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Cross-process lock. A crashed owner's lock fails safely and is never stolen. */
export async function withCanvasLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, '.write-lock');
  for (let attempt = 0; attempt < 50; attempt++) {
    let lock;
    try {
      lock = await open(path, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;

      await new Promise((resolve) => setTimeout(resolve, 20));
      continue;
    }

    try {
      await lock.writeFile(String(process.pid));
      return await action();
    } finally {
      await lock.close();
      await rm(path, { force: true });
    }
  }
  throw new CanvasError('Canvas is busy. If its owner crashed, remove canvas/.write-lock and retry.', 503);
}
