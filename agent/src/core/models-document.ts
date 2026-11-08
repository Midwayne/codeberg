import { readFileSync } from 'node:fs';
import { parseDocument } from 'yaml';
import { readOptionalText } from './learning/fs.js';

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
  const raw = await readOptionalText(path);
  if (raw === undefined) return { found: false };

  return { found: true, value: modelsDocument(raw) };
}

export function readModelsDocumentSync(path: string): unknown {
  return modelsDocument(readFileSync(path, 'utf8'));
}
