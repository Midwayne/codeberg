import type { ModelInput } from '../model-types.js';

/** Largest prompt attachment the composer accepts and `/api/chat` admits. */
export const MAX_PROMPT_FILE_BYTES = 20 * 1024 * 1024;

/** The model input capability a prompt attachment needs, by its media type. */
export function modelInputForMediaType(mediaType: string): ModelInput | undefined {
  if (mediaType.startsWith('image/')) return 'vision';
  if (mediaType.startsWith('audio/')) return 'audio';
  if (mediaType.startsWith('video/')) return 'video';
  if (mediaType === 'application/pdf') return 'pdf';

  return undefined;
}
