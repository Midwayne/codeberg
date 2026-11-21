import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isValidSessionId } from './records.js';
import { ifMissing } from '../../core/fs.js';

/** Count regular run files without following symlinks outside the chat's storage. */
export async function sessionRunBytes(directory: string, id: string): Promise<number> {
  if (!isValidSessionId(id)) return 0;

  const paths = [join('.runs', id), join('.jobs', id), join('.context', `${id}.json`)];
  const sizes = await Promise.all(paths.map((path) => directoryBytes(join(directory, path))));

  return sizes.reduce((sum, size) => sum + size, 0);
}

async function directoryBytes(path: string): Promise<number> {
  const info = await lstat(path).catch(ifMissing(undefined));
  if (!info) return 0;
  if (info.isFile()) return info.size;
  if (!info.isDirectory()) return 0;

  const sizes = await Promise.all((await readdir(path)).map((name) => directoryBytes(join(path, name))));

  return sizes.reduce((sum, size) => sum + size, 0);
}
