import { mkdir, rmdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatasetStoreState } from './state.js';

export async function withPromotionLock<T>(
  state: DatasetStoreState,
  action: () => Promise<T>,
): Promise<T> {
  // A local lock makes the split decision atomic across processes.
  const lock = join(state.store.root, 'datasets', '.promotion-lock');
  await mkdir(join(state.store.root, 'datasets'), { recursive: true });
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;

    if (Date.now() - (await stat(lock)).mtimeMs < 10 * 60_000)
      throw new Error('dataset promotion in progress');

    await rmdir(lock);
    await mkdir(lock);
  }

  try {
    return await action();
  } finally {
    await rmdir(lock).catch(() => undefined);
  }
}
