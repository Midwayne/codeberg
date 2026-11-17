import { open, readFile, rm, stat } from 'node:fs/promises';

export interface FileLockOptions {
  /** How long to keep retrying a held lock; 0 fails at once. */
  timeoutMs: number;
  intervalMs: number;
  /** A lock without a readable owner PID is abandoned after this age. */
  staleMs: number;
  /** The error to throw when the lock stays held. */
  busy: () => Error;
}

/**
 * Cross-process lock file holding the owner's PID. A lock whose owner has
 * exited is recovered; a live owner's lock is never taken over.
 */
export async function acquireFileLock(path: string, options: FileLockOptions): Promise<() => Promise<void>> {
  const deadline = Date.now() + options.timeoutMs;

  for (;;) {
    if (await tryCreate(path)) return () => rm(path, { force: true });

    if (await abandoned(path, options.staleMs)) {
      await rm(path, { force: true, recursive: true });
      continue;
    }

    if (Date.now() >= deadline) throw options.busy();

    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
}

export async function withFileLock<T>(path: string, options: FileLockOptions, action: () => Promise<T>): Promise<T> {
  const release = await acquireFileLock(path, options);

  try {
    return await action();
  } finally {
    await release();
  }
}

async function tryCreate(path: string): Promise<boolean> {
  try {
    const handle = await open(path, 'wx', 0o600);
    try {
      await handle.writeFile(String(process.pid));
    } finally {
      await handle.close();
    }

    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;

    return false;
  }
}

/** The recorded owner is gone, or no owner was recorded and the lock is old. */
async function abandoned(path: string, staleMs: number): Promise<boolean> {
  const pid = Number(await readFile(path, 'utf8').catch(() => ''));
  if (Number.isInteger(pid) && pid > 0) return !alive(pid);

  // A process may exit between creating the lock and writing its PID.
  const file = await stat(path).catch(() => undefined);

  return file !== undefined && Date.now() - file.mtimeMs > staleMs;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}
