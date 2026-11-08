import type { Dirent } from 'node:fs';
import { link, lstat, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/** File text, or `undefined` when the path is missing. Every other error is thrown. */
export async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (missing(error)) return undefined;

    throw error;
  }
}

/** Directory names, or an empty list when the directory is missing. */
export async function readOptionalDirectory(path: string): Promise<string[]>;
export async function readOptionalDirectory(path: string, withFileTypes: true): Promise<Dirent[]>;
export async function readOptionalDirectory(
  path: string,
  withFileTypes = false,
): Promise<string[] | Dirent[]> {
  try {
    if (withFileTypes) return await readdir(path, { withFileTypes: true });

    return await readdir(path);
  } catch (error) {
    if (missing(error)) return [];

    throw error;
  }
}

/** `lstat` result, or `undefined` when the path is missing. Symlinks are not followed. */
export async function optionalLstat(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (missing(error)) return undefined;

    throw error;
  }
}

/**
 * Records in one directory. A missing or unreadable directory is empty.
 * One bad file is skipped, and `sort` orders the selected names before reading.
 */
export async function readRecordFiles<T>(
  dir: string,
  include: (name: string) => boolean,
  parse: (raw: string) => T,
  sort = false,
): Promise<T[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }

  const selected = names.filter(include);
  if (sort) selected.sort();

  const records: T[] = [];
  for (const name of selected) {
    try {
      records.push(parse(await readFile(join(dir, name), 'utf8')));
    } catch {
      // One unreadable record must not hide the rest of the directory.
    }
  }

  return records;
}

/** Removes a path. A path that is already gone is success. */
export async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!missing(error)) throw error;
  }
}

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

export async function writeAtomic(path: string, value: string): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
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
