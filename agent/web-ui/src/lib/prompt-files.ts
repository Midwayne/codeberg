import type { CatalogModel } from './models';

export const MAX_HEIGHT = 200;
export const MAX_FILE_SIZE = 20 * 1024 * 1024;

export function inputFor(file: File): CatalogModel['inputs'][number] | undefined {
  if (file.type.startsWith('image/')) return 'vision';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type === 'application/pdf') return 'pdf';
  return undefined;
}

export function clipboardImages(files: FileList, inputs: readonly CatalogModel['inputs'][number][]): File[] {
  return inputs.includes('vision') ? Array.from(files).filter((file) => file.type.startsWith('image/')) : [];
}
