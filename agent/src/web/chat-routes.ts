import type { SearchRuns } from './runs/manager.js';
import { submitSearch } from './runs/routes.js';
import { validChatId } from '../core/canvas/context.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { ModelInput, ModelSelection } from '../core/model-types.js';
import { readJson, sendJson, sendText } from './http.js';
import type { ModelSettingsStore } from './model-selection/settings.js';
import { chatModelTitle, selectedChatModel } from './title.js';
import { MAX_PROMPT_FILE_BYTES, modelInputForMediaType } from '../core/api/files.js';
import type { DecisionModel } from '../core/decisions/types.js';

/** A model choice bound to one chat request. */
export type ResolvedModelSelection = ModelSelection & {
  model: string; contextWindow: number; inputs?: ModelInput[]; decisionModel?: DecisionModel | null;
};

export async function routeChat(
  req: IncomingMessage,
  res: ServerResponse,
  modelSettings: ModelSettingsStore | undefined,
  runs: SearchRuns,
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
  const selected = settings && selectedChatModel(settings);
  const error = validateChatFiles(messages, selected?.inputs ?? ['text']);
  if (error) return sendText(res, 400, error);

  const selection = selected && settings
    ? { ...settings.chat, model: selected.model, contextWindow: selected.contextWindow, inputs: selected.inputs,
      decisionModel: settings.decisionModels?.find((item) => item.key === settings.decisions) ?? null }
    : undefined;

  await submitSearch(res, body, selection, runs);
}

export async function routeMeta(
  res: ServerResponse,
  options: { title: string; learningEnabled: boolean; modelSettings?: ModelSettingsStore },
): Promise<void> {
  const settings = await options.modelSettings?.current();
  const title = (settings && chatModelTitle(settings)) ?? options.title;

  sendJson(res, 200, { title, capabilities: { learning: options.learningEnabled } });
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
      const input = typeof mediaType === 'string' ? modelInputForMediaType(mediaType) : undefined;

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

      if (part.url.length - part.url.indexOf(',') - 1 > Math.ceil((MAX_PROMPT_FILE_BYTES * 4) / 3) + 4) {
        return 'files must be 20 MB or smaller';
      }
    }
  }

  return undefined;
}
