import { prepareSkillFiles, type SkillFile } from './skill-files';
import { errorMessage } from '@agent/core/errors.js';
import { ensureOk, jsonInit } from './http';

/** Reads the chosen files and asks the server what each readable one would import as. */
export async function previewSkillFiles(selected: File[], api: typeof fetch, signal: AbortSignal): Promise<SkillFile[]> {
  const prepared = await prepareSkillFiles(selected);
  const readable = prepared.filter((file) => !file.error);
  let results: SkillFile[] = [];

  if (readable.length) {
    const response = await api('/api/extensions/skills/preview', jsonInit('POST', { files: readable }, { signal }));

    await ensureOk(response);

    results = ((await response.json()) as { files: SkillFile[] }).files;
  }

  // Results come back in the order of the readable files only.
  let index = 0;

  return prepared.map((file) => (file.error ? file : { ...file, ...results[index++] }));
}

type SkillImportOutcome = { imported: number; remaining: SkillFile[] };

/** Imports each ready file in turn; files that are not ready or fail stay in `remaining`. Stops when aborted. */
export async function importSkillFiles(
  files: SkillFile[],
  scope: string,
  api: typeof fetch,
  signal: AbortSignal,
): Promise<SkillImportOutcome> {
  const remaining: SkillFile[] = [];
  let imported = 0;

  for (const file of files) {
    if (signal.aborted) break;

    if (file.error || !file.name || file.content === undefined) {
      remaining.push(file);
      continue;
    }

    try {
      await importSkillFile(api, scope, file, signal);
      imported++;
    } catch (reason) {
      if (signal.aborted) break;

      remaining.push({ ...file, importError: errorMessage(reason) });
    }
  }

  return { imported, remaining };
}

async function importSkillFile(api: typeof fetch, scope: string, file: SkillFile, signal: AbortSignal): Promise<void> {
  const response = await api('/api/extensions', jsonInit('POST', { kind: 'skill', scope, name: file.name, content: file.content }, { signal }));

  await ensureOk(response);
}
