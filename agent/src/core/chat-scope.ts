import { AsyncLocalStorage } from 'node:async_hooks';
import { access, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { writeAtomic } from './fs.js';

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

/**
 * Write a chat's side file only while the chat exists. Deleting a chat
 * unlinks its record before its side files, so checking again after the
 * write catches a deletion that ran in between: the late file is removed.
 * Returns false when the chat is gone.
 */
export async function writeChatSideFile(
  sideFile: string,
  content: string,
  exists: (sideFile: string) => Promise<boolean> = chatRecordExists,
): Promise<boolean> {
  if (!await exists(sideFile)) return false;

  // Side files can quote private source, so new directories are private too.
  await writeAtomic(sideFile, content, { dirMode: 0o700 });
  if (await exists(sideFile)) return true;

  await rm(sideFile, { force: true });

  return false;
}
