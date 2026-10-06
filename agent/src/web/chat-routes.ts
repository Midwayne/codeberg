import { validChatId, withCanvasChat } from '../core/canvas/context.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { ModelInput, ModelSelection } from '../core/model-types.js';
import { readJson, sendText } from './http.js';
import type { ModelSettingsStore } from './model-selection/settings.js';
import { formatWebTitle } from './title.js';

/** A model choice bound to one chat request. */
export type ResolvedModelSelection = ModelSelection & { model: string; contextWindow: number };

export type ChatResponder = (
  res: ServerResponse,
  messages: unknown[],
  selected?: ResolvedModelSelection,
) => Promise<void>;

export async function routeChat(
  req: IncomingMessage,
  res: ServerResponse,
  modelSettings: ModelSettingsStore | undefined,
  respond: ChatResponder,
): Promise<void> {
  const body = await readJson(req);
  if (body?.id !== undefined) {
    try {
      validChatId(body.id);
    } catch {
      return sendText(res, 400, 'invalid chat id');
    }
  }

  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const settings = await modelSettings?.current();
  const selected = settings?.models.find((entry) => entry.key === settings.chat.key);
  const error = validateChatFiles(messages, selected?.inputs ?? ['text']);
  if (error) return sendText(res, 400, error);

  await withCanvasChat(body?.id, () =>
    respond(
      res,
      messages,
      selected && settings
        ? {
            ...settings.chat,
            model: selected.model,
            contextWindow: selected.contextWindow,
          }
        : undefined,
    ),
  );
}

export async function routeMeta(
  res: ServerResponse,
  options: { title: string; learningEnabled: boolean; modelSettings?: ModelSettingsStore },
): Promise<void> {
  const settings = await options.modelSettings?.current();
  const selected = settings?.models.find((entry) => entry.key === settings.chat.key);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(
    JSON.stringify({
      title:
        settings && selected
          ? `${formatWebTitle(selected.model, settings.chat.effort)}${selected.key !== selected.model ? ` · ${selected.key.slice(selected.provider.length + 1)}` : ''}`
          : options.title,
      capabilities: { learning: options.learningEnabled },
    }),
  );
}

/** Check each submitted file, including previous turns sent again by the browser. */
function validateChatFiles(messages: unknown[], inputs: readonly ModelInput[]): string | undefined {
  for (const message of messages) {
    if (
      !message ||
      typeof message !== 'object' ||
      !('parts' in message) ||
      !Array.isArray(message.parts)
    )
      continue;

    for (const part of message.parts) {
      if (!part || typeof part !== 'object' || part.type !== 'file') continue;

      const mediaType = part.mediaType;
      const input: ModelInput | undefined =
        typeof mediaType === 'string'
          ? mediaType.startsWith('image/')
            ? 'vision'
            : mediaType.startsWith('audio/')
              ? 'audio'
              : mediaType.startsWith('video/')
                ? 'video'
                : mediaType === 'application/pdf'
                  ? 'pdf'
                  : undefined
          : undefined;

      if (!input || !inputs.includes(input))
        return `selected model does not support ${String(mediaType)} files`;

      // Files are embedded in the UI-message history and never fetched from arbitrary URLs.
      if (
        typeof part.url !== 'string' ||
        !part.url.startsWith(`data:${mediaType};base64,`) ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(part.url.slice(part.url.indexOf(',') + 1))
      ) {
        return 'files must be base64 data URLs matching their media type';
      }

      if (part.url.length - part.url.indexOf(',') - 1 > Math.ceil((20 * 1024 * 1024 * 4) / 3) + 4) {
        return 'files must be 20 MB or smaller';
      }
    }
  }

  return undefined;
}
