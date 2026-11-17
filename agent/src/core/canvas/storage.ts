import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CanvasError } from './types.js';
import { isMissing, writeAtomic } from '../fs.js';
import { withFileLock } from '../fs-lock.js';

export async function readData(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (isMissing(error)) return undefined;

    const reason = error instanceof SyntaxError ? 'invalid JSON' : (error as NodeJS.ErrnoException).code ?? 'unreadable file';
    throw new CanvasError(`Cannot read canvas data: ${reason}`, 503);
  }
}

/** Canvas data stays private to the user: new directories are created 0700. */
export async function atomicWrite(path: string, value: unknown): Promise<void> {
  await writeAtomic(path, JSON.stringify(value), { dirMode: 0o700 });
}

/** Cross-process lock. A crashed owner's lock is recovered; a live owner's is never taken over. */
export async function withCanvasLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  await mkdir(root, { recursive: true, mode: 0o700 });

  return withFileLock(join(root, '.write-lock'), {
    timeoutMs: 1_000,
    intervalMs: 20,
    staleMs: 10_000,
    busy: () => new CanvasError('Canvas is busy. Retry in a moment.', 503),
  }, action);
}
