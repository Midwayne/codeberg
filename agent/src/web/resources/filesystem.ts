import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArtifact } from '../../core/learning/store.js';
import { isValidSessionId } from '../sessions/store.js';
import { type CleanupCategory, ResourceSettingsError, type StoredFile } from './types.js';

export async function readStoredFile(
  path: string,
  name: string,
  category: CleanupCategory,
): Promise<StoredFile | undefined> {
  const info = await fileInfo(path);
  if (!info) return undefined;

  try {
    const raw = await readRegularFile(path);
    const record = category === 'knowledge' ? parseArtifact(raw) : JSON.parse(raw);
    const id = name.slice(0, -5);
    if (category === 'chats' && (!isValidSessionId(id) || record.id !== id || record.pinned))
      return undefined;

    const age =
      category === 'chats'
        ? record.updatedAt
        : Date.parse(
            category === 'training'
              ? (record.review?.timestamp ?? record.extracted_at)
              : record.updated_at,
          );

    if (!Number.isFinite(age)) return undefined;

    return {
      path,
      id: category === 'chats' ? id : name,
      age,
      size: info.size,
      ino: info.ino,
      mtimeMs: info.mtimeMs,
    };
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code &&
      !['ENOENT', 'ELOOP'].includes((error as NodeJS.ErrnoException).code!)
    )
      throw error;
    // Malformed records cannot establish an age and are not cleanup targets.
  }

  return undefined;
}

export function ageCutoff(days: unknown): number {
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 0 || days > 36500)
    throw new ResourceSettingsError('Age must be a whole number of days between 0 and 36500.');

  return days === 0 ? Infinity : Date.now() - days * 86_400_000;
}

export async function fileInfo(path: string) {
  try {
    const info = await lstat(path);

    return info.isFile() ? info : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;

    throw error;
  }
}

export async function realDirectory(path: string, boundary: string): Promise<boolean> {
  try {
    if (!(await lstat(path)).isDirectory()) return false;

    const parent = dirname(path);

    return path === boundary || parent === path || (await realDirectory(parent, boundary));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;

    throw error;
  }
}

export async function readRegularFile(path: string): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await file.stat()).isFile()) throw new Error('not a regular file');

    return await file.readFile('utf8');
  } finally {
    await file.close();
  }
}
