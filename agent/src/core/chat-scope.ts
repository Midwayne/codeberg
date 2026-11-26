import { AsyncLocalStorage } from 'node:async_hooks';
import { access } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/**
 * The chat a run belongs to (its saved-session directory), set around every
 * browser chat run. Chat-owned state, such as kept browser sessions and
 * subagents, is keyed by it; terminal runs have none.
 */
export const chatScope = new AsyncLocalStorage<string>();

/**
 * Whether the chat a side file belongs to (`<sessions>/.<kind>/<id>.json`)
 * still has its record (`<sessions>/<id>.json`). Writers check it so a late
 * write cannot recreate data that deleting the chat removed.
 */
export async function chatRecordExists(sideFile: string): Promise<boolean> {
  try {
    await access(join(dirname(dirname(sideFile)), basename(sideFile)));

    return true;
  } catch {
    return false;
  }
}
