import { lstat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { load } from './reading.js';
import type { WebSessionStoreState } from './state.js';
import { serial } from './writing.js';

export async function remove(state: WebSessionStoreState, id: string): Promise<void> {
  await serial(state, id, async () => {
    try {
      await unlink(join(state.dir, `${id}.json`));
    } catch {
      // already gone / unreadable — nothing to do
    }
  });
}

export async function removeOlder(
  state: WebSessionStoreState,
  id: string,
  cutoff: number,
): Promise<number | undefined> {
  return serial(state, id, async () => {
    const path = join(state.dir, `${id}.json`);
    const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;

      throw error;
    });

    if (!info?.isFile()) return undefined;

    const record = await load(state, id);
    if (!record || record.pinned || !(record.updatedAt < cutoff)) return undefined;

    await unlink(path);

    return info.size;
  });
}
