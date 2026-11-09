import { closeBrowserSessions } from '../../core/browser/sessions.js';
import { sessionRunBytes } from './run-storage.js';
import { rm, unlink } from 'node:fs/promises';
import { optionalLstat } from '../../core/learning/fs.js';
import { join } from 'node:path';
import { sessionJobsDir, sessionRunsDir } from './layout.js';
import { load } from './reading.js';
import type { WebSessionStoreState } from './state.js';
import { serial } from './writing.js';

export async function remove(state: WebSessionStoreState, id: string): Promise<void> {
  await serial(state, id, async () => {
    await closeBrowserSessions({ owner: join(state.dir, id) });
    try {
      await unlink(join(state.dir, `${id}.json`));
      await rm(sessionRunsDir(state.dir, id), { recursive: true, force: true });
      await rm(sessionJobsDir(state.dir, id), { recursive: true, force: true });
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
    const info = await optionalLstat(path);

    if (!info?.isFile()) return undefined;

    const record = await load(state, id);
    if (!record || record.pinned || !(record.updatedAt < cutoff)) return undefined;

    const bytes = info.size + await sessionRunBytes(state.dir, id);
    await closeBrowserSessions({ owner: join(state.dir, id) });

    await unlink(path);
    await rm(sessionRunsDir(state.dir, id), { recursive: true, force: true });
    await rm(sessionJobsDir(state.dir, id), { recursive: true, force: true });

    return bytes;
  });
}
