import { readFile } from 'node:fs/promises';

import type { CatalogOverrides } from '../../core/model-types.js';
import type { ModelOverrides } from '../../providers/overrides.js';

/** Catalog overrides for one chat request, with the instructions file read.
 *  Reading per request means an edited file applies to the next turn. */
export async function resolveOverrides(catalog: CatalogOverrides | undefined): Promise<ModelOverrides | undefined> {
  if (!catalog) return undefined;

  const { instructionsFile, ...rest } = catalog;
  if (!instructionsFile) return rest;

  return { ...rest, instructions: await readInstructions(instructionsFile) };
}

async function readInstructions(path: string): Promise<string> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(`cannot read model instructions ${path}: ${(error as Error).message}`);
  }

  if (!text.trim()) throw new Error(`model instructions ${path} are empty`);

  return text;
}
