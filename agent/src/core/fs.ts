import { link, mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function appendDurable(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const file = await open(path, 'a+', 0o600);
  try {
    const { size } = await file.stat();
    let separator = '';
    if (size > 0) {
      const last = Buffer.allocUnsafe(1);
      await file.read(last, 0, 1, size - 1);
      if (last[0] !== 0x0a) separator = '\n';
    }

    // One O_APPEND write keeps concurrent process records from interleaving.
    // The leading newline quarantines an incomplete tail left by a killed writer.
    await file.write(`${separator}${JSON.stringify(value)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeAtomic(path, JSON.stringify(value, null, 2) + '\n');
}

/** Publish a version exactly once: an interrupted writer leaves no visible record. */
export async function writeJsonImmutable(path: string, value: unknown): Promise<boolean> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const temp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const file = await open(temp, 'wx', 0o600);
  try {
    try {
      await file.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }

    try {
      await link(temp, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;

      throw error;
    }

    await syncDirectory(dir);

    return true;
  } finally {
    await unlink(temp);
  }
}

/** Replace a file all at once: readers see the old or the new content, never a partial write. */
export async function writeAtomic(path: string, value: string, options: { dirMode?: number } = {}): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: options.dirMode });
  const temp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    const file = await open(temp, 'wx', 0o600);
    try {
      await file.writeFile(value, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }

    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }

  await syncDirectory(dir);
}

async function syncDirectory(path: string): Promise<void> {
  try {
    const dir = await open(path, 'r');
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  } catch {
    // Some platforms/filesystems do not allow fsync on directories. The file
    // itself has still been synced before the atomic rename.
  }
}

/** True for "no such file or directory". */
export function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/** A `.catch` handler: a missing file or directory yields `fallback`; other errors are rethrown. */
export function ifMissing<T>(fallback: T): (error: unknown) => T {
  return (error) => {
    if (!isMissing(error)) throw error;

    return fallback;
  };
}

/**
 * Parses JSONL written by {@link appendDurable}. A process can die during its
 * final append; complete lines stay authoritative and a malformed one is skipped.
 */
export function parseJsonLines<T>(raw: string): T[] {
  const rows: T[] = [];

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;

    try {
      rows.push(JSON.parse(line) as T);
    } catch {
      // Torn tail from an interrupted writer.
    }
  }

  return rows;
}
