import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileInfo, readRegularFile, readStoredFile, realDirectory } from './filesystem.js';
import type { ResourceSettingsState } from './state.js';
import type { CleanupCategory, StoredFile } from './types.js';

export async function listFiles(
  state: ResourceSettingsState,
  category: CleanupCategory,
  cutoff: number,
): Promise<StoredFile[]> {
  const files: StoredFile[] = [];
  const dirs =
    category === 'chats'
      ? [state.options.sessions.dir]
      : category === 'training'
        ? ['candidates', 'training', 'eval', 'dismissed'].map((bucket) =>
            join(state.learningRoot, 'datasets', bucket),
          )
        : ['services', 'flows', 'concepts', 'debugging'].map((bucket) =>
            join(state.learningRoot, 'knowledge', bucket),
          );

  for (const dir of dirs) {
    if (
      !(await realDirectory(
        dir,
        category === 'chats' ? state.options.sessions.dir : state.learningRoot,
      ))
    )
      continue;

    for (const name of await readdir(dir)) {
      if (!name.endsWith(category === 'knowledge' ? '.md' : '.json')) continue;

      const path = join(dir, name);
      const file = await readStoredFile(path, name, category);
      if (file) files.push(file);
    }
  }

  if (category === 'knowledge') files.push(...(await dreamingFiles(state)));

  // Candidate and review copies form a family: preserve all if any copy was recently reviewed.
  const newest = new Map<string, number>();
  for (const file of files) newest.set(file.id, Math.max(newest.get(file.id) ?? 0, file.age));

  return files.filter((file) => (newest.get(file.id) ?? Infinity) < cutoff);
}

/** A report and its decision receipts form one age-filtered knowledge revision family. */
export async function dreamingFiles(state: ResourceSettingsState): Promise<StoredFile[]> {
  const dir = join(state.learningRoot, 'dreaming');
  if (!(await realDirectory(dir, state.learningRoot))) return [];

  const files: StoredFile[] = [];
  const add = async (path: string, id: string, receipt: boolean) => {
    const info = await fileInfo(path);
    if (!info) return;

    try {
      const record = JSON.parse(await readRegularFile(path));
      const age = Date.parse(receipt ? record.decisions?.at(-1)?.timestamp : record.created_at);
      if (!Number.isFinite(age)) return;

      files.push({ path, id, age, size: info.size, ino: info.ino, mtimeMs: info.mtimeMs });
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code &&
        !['ENOENT', 'ELOOP'].includes((error as NodeJS.ErrnoException).code!)
      )
        throw error;
    }
  };

  for (const name of await readdir(dir)) {
    if (/^dream-[a-z0-9-]{1,70}\.json$/.test(name))
      await add(join(dir, name), name.slice(0, -5), false);

    if (
      !/^dream-[a-z0-9-]{1,70}$/.test(name) ||
      !(await realDirectory(join(dir, name), state.learningRoot))
    )
      continue;

    for (const revision of await readdir(join(dir, name))) {
      if (/^\d{8}\.json$/.test(revision)) await add(join(dir, name, revision), name, true);
    }
  }

  return files;
}
