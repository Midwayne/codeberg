import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { DatasetStore } from '../../core/learning/datasets.js';
import { LearningStore } from '../../core/learning/store.js';
import { writeModuleLog } from '../../core/module-log.js';
import { listFiles } from './catalog.js';
import { ageCutoff, fileInfo, realDirectory } from './filesystem.js';
import type { ResourceSettingsState } from './state.js';
import type { StoredFile } from './types.js';
import { CLEANUP_CATEGORIES, type CleanupCategory, ResourceSettingsError } from './types.js';

export async function preview(state: ResourceSettingsState, olderThanDays: unknown) {
  const cutoff = ageCutoff(olderThanDays);
  const categories = await Promise.all(
    CLEANUP_CATEGORIES.map(async (category) => {
      const files = await listFiles(state, category, cutoff);

      return {
        category,
        count: files.length,
        bytes: files.reduce((sum, file) => sum + file.size, 0),
      };
    }),
  );

  return { categories, cutoff, olderThanDays };
}

export async function cleanup(state: ResourceSettingsState, input: unknown) {
  const body = input as { categories?: unknown; olderThanDays?: unknown } | null;
  const cutoff = ageCutoff(body?.olderThanDays);
  if (
    !Array.isArray(body?.categories) ||
    !body.categories.length ||
    body.categories.some((value) => !CLEANUP_CATEGORIES.includes(value)) ||
    new Set(body.categories).size !== body.categories.length
  ) {
    throw new ResourceSettingsError('Select one or more valid cleanup categories.');
  }

  const categories = body.categories as CleanupCategory[];
  if (state.busy) throw new ResourceSettingsError('Cleanup is already running.', 409);

  state.busy = true;
  const remove = () => removeFiles(state, categories, cutoff);

  try {
    const locked = async () =>
      (await realDirectory(join(state.learningRoot, 'datasets'), state.learningRoot))
        ? new DatasetStore(
            state.options.learning?.store ?? new LearningStore(state.learningRoot),
          ).withPromotionLock(remove)
        : remove();

    const action = categories.includes('training') ? locked : remove;

    return state.options.learning && categories.some((category) => category !== 'chats')
      ? await state.options.learning.withMaintenance(action)
      : await action();
  } catch (error) {
    if (/learning is busy|promotion in progress/.test(String(error)))
      throw new ResourceSettingsError(
        'Learning is busy. Try cleanup again after background jobs finish.',
        409,
      );

    throw error;
  } finally {
    state.busy = false;
  }
}

export async function removeFiles(
  state: ResourceSettingsState,
  categories: CleanupCategory[],
  cutoff: number,
) {
  let deleted = 0;
  let bytesFreed = 0;
  let failed = 0;
  const deletedChatIds: string[] = [];
  // Establish all target lists before the first deletion, so discovery errors
  // cannot leave the client unaware of a partially deleted earlier category.
  const targets = await Promise.all(
    categories.map(async (category) => ({
      category,
      files: await listFiles(state, category, cutoff),
    })),
  );

  for (const { category, files } of targets) {
    for (const file of files) {
      try {
        if (category === 'chats') {
          const size = await state.options.sessions.removeOlder(file.id, cutoff);
          if (size !== undefined) {
            deleted++;
            bytesFreed += size;
            deletedChatIds.push(file.id);
          }
        } else {
          if (!(await unchangedFile(file))) continue;

          await unlink(file.path);
          deleted++;
          bytesFreed += file.size;
        }
      } catch (error) {
        failed++;
        writeModuleLog('agent', 'cleanup_file_failed', { category, error: String(error) });
      }
    }
  }

  state.monitor.invalidateDisk();

  return { deleted, failed, bytesFreed, categories, deletedChatIds };
}

async function unchangedFile(file: StoredFile): Promise<boolean> {
  const current = await fileInfo(file.path);
  if (
    !current ||
    current.ino !== file.ino ||
    current.mtimeMs !== file.mtimeMs ||
    current.size !== file.size
  )
    return false;

  return true;
}
