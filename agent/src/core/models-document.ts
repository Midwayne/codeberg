import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { parseDocument } from 'yaml';

export interface ModelsFile {
  found: boolean;
  value?: unknown;
}

/** Parse one models.yml document. Duplicate keys are rejected. */
export function modelsDocument(raw: string): unknown {
  const document = parseDocument(raw, { uniqueKeys: true });
  if (document.errors.length) throw new Error(`invalid models.yml: ${document.errors[0].message}`);

  return document.toJS();
}

export async function readModelsDocument(path: string): Promise<ModelsFile> {
  try {
    return { found: true, value: modelsDocument(await readFile(path, 'utf8')) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { found: false };

    throw error;
  }
}

export function readModelsDocumentSync(path: string): unknown {
  return modelsDocument(readFileSync(path, 'utf8'));
}
