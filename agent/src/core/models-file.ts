import { readFile } from 'node:fs/promises';
import { parseDocument } from 'yaml';

import { isMissing } from './fs.js';

/** The user's models.yml catalog, parsed: missing when the file does not exist. */
export type ModelsFile = { missing: true } | { missing: false; root: unknown };

/** Reads and parses models.yml once so the model and decision catalogs can share it. */
export async function readModelsFile(path: string): Promise<ModelsFile> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (!isMissing(error)) throw error;

    return { missing: true };
  }

  const document = parseDocument(raw, { uniqueKeys: true });
  if (document.errors.length) throw new Error(`invalid models.yml: ${document.errors[0].message}`);

  return { missing: false, root: document.toJS() };
}
