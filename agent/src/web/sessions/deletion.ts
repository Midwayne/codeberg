import { closeBrowserSessions } from '../../core/browser/sessions.js';
import { sessionRunBytes } from './run-storage.js';
import { lstat, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { load } from './reading.js';
import type { WebSessionStoreState } from './state.js';
import { serial } from './writing.js';
import { ifMissing } from '../../core/fs.js';
import { contextStatsPath } from './context-stats.js';
import { contextKeepsPath } from '../../core/request-budget/selection.js';

export async function remove(state: WebSessionStoreState, id: string): Promise<void> {
  await serial(state, id, async () => {
    await closeBrowserSessions({ owner: join(state.dir, id) });

    // Each file goes on its own, so a chat whose record is already gone still loses its runs and stats.
    await unlink(join(state.dir, `${id}.json`)).catch(() => undefined);
    await removeChatFiles(state.dir, id);
  });
}

/** Run journals, background jobs, context stats, the working list, and kept results stored beside a chat. */
async function removeChatFiles(dir: string, id: string): Promise<void> {
  const paths = [join(dir, '.runs', id), join(dir, '.jobs', id), contextStatsPath(dir, id), join(dir, '.worklists', `${id}.json`), contextKeepsPath(dir, id)];

  await Promise.all(paths.map((path) => rm(path, { recursive: true, force: true }).catch(() => undefined)));
}

export async function removeOlder(
  state: WebSessionStoreState,
  id: string,
  cutoff: number,
): Promise<number | undefined> {
  return serial(state, id, async () => {
    const path = join(state.dir, `${id}.json`);
    const info = await lstat(path).catch(ifMissing(undefined));

    if (!info?.isFile()) return undefined;

    const record = await load(state, id);
    if (!record || record.pinned || !(record.updatedAt < cutoff)) return undefined;

    const bytes = info.size + await sessionRunBytes(state.dir, id);
    await closeBrowserSessions({ owner: join(state.dir, id) });

    await unlink(path);
    await removeChatFiles(state.dir, id);

    return bytes;
  });
}
