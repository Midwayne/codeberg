import type { UIMessage } from 'ai';

import type { CatalogModel } from './models';

type ModelInput = CatalogModel['inputs'][number];

export const MAX_HEIGHT = 200;
export const MAX_FILE_SIZE = 20 * 1024 * 1024;

export function inputFor(file: File): ModelInput | undefined {
  return mediaInput(file.type);
}

/** The model input a media type needs; the server checks files the same way. */
function mediaInput(mediaType: string): ModelInput | undefined {
  if (mediaType.startsWith('image/')) return 'vision';
  if (mediaType.startsWith('audio/')) return 'audio';
  if (mediaType.startsWith('video/')) return 'video';
  if (mediaType === 'application/pdf') return 'pdf';
  return undefined;
}

/** Inputs the chat's earlier files need; every request resends them to the model. */
export function historyInputs(messages: readonly UIMessage[]): ModelInput[] {
  const inputs = new Set<ModelInput>();

  for (const message of messages) {
    for (const part of message.parts) {
      const input = part.type === 'file' ? mediaInput(part.mediaType) : undefined;
      if (input) inputs.add(input);
    }
  }

  return [...inputs];
}

export function clipboardImages(files: FileList, inputs: readonly CatalogModel['inputs'][number][]): File[] {
  return inputs.includes('vision') ? Array.from(files).filter((file) => file.type.startsWith('image/')) : [];
}
