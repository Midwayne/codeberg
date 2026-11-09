import { modelInputForMediaType } from '@agent/core/api/files.js';
import type { CatalogModel } from '@agent/core/model-types.js';

export const MAX_HEIGHT = 200;

export function inputFor(file: File): CatalogModel['inputs'][number] | undefined {
  return modelInputForMediaType(file.type);
}

export function clipboardImages(files: FileList, inputs: readonly CatalogModel['inputs'][number][]): File[] {
  return inputs.includes('vision') ? Array.from(files).filter((file) => file.type.startsWith('image/')) : [];
}
