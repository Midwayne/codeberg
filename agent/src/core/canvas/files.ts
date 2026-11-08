import { CanvasError } from './types.js';

export const CANVAS_SETTINGS_FILE = 'settings.json';

/** Scene name for a chat, without the `.excalidraw` suffix the store appends. */
export function canvasChatName(chatId: string | undefined): string {
  if (!chatId) throw new CanvasError('A chat is required.');

  return `chat-${chatId}`;
}
