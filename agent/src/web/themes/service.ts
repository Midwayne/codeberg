import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LanguageModel } from 'ai';

import { fromAiSdk } from '../../core/generator.js';
import { HttpError } from '../../core/http-error.js';
import { errorMessage } from '../../core/errors.js';
import type { ModelSettingsStore } from '../model-selection/settings.js';
import { requireJsonMutation, sendJson, sendText } from '../http.js';
import { THEME_SYSTEM_PROMPT, themePrompt } from './prompt.js';
import { readThemeRequest, themeFromReply, type ThemeRequest } from './request.js';

export const THEME_GENERATE_PATH = '/api/themes/generate';

export interface ThemeService {
  generate(request: ThemeRequest, signal?: AbortSignal): Promise<Record<string, unknown>>;
}

/** Designs themes on the current chat model, so no separate model is needed. */
export function createThemeService(
  settings: Pick<ModelSettingsStore, 'current'>,
  resolveModel: (spec: string) => LanguageModel,
  transformModel?: (model: LanguageModel, key: string, spec: string) => LanguageModel,
): ThemeService {
  return {
    async generate(request, signal) {
      const { chat, models } = await settings.current();
      const spec = models.find((entry) => entry.key === chat.key)?.model ?? chat.key;
      const model = resolveModel(spec);
      const tracked = transformModel ? transformModel(model, chat.key, spec) : model;

      const text = await fromAiSdk(tracked, chat.effort, spec).generate({
        system: THEME_SYSTEM_PROMPT,
        prompt: themePrompt(request),
        maxOutputTokens: 4000,
        ...(signal ? { abortSignal: signal } : {}),
      });

      return themeFromReply(text);
    },
  };
}

export async function routeThemes(req: IncomingMessage, res: ServerResponse, service: ThemeService): Promise<void> {
  if (!requireJsonMutation(req, res, 'POST', 'theme requests')) return;

  // A closed tab stops the model call instead of paying for an unused theme.
  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) abort.abort();
  });

  try {
    const request = await readThemeRequest(req);

    sendJson(res, 200, { theme: await service.generate(request, abort.signal) });
  } catch (error) {
    if (abort.signal.aborted) return;

    const status = error instanceof HttpError ? error.status : 502;

    sendText(res, status, errorMessage(error, 'The chat model could not create a theme.'));
  }
}
