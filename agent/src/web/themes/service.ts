import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LanguageModel } from 'ai';

import { fromAiSdk } from '../../core/generator.js';
import type { ReasoningEffort } from '../../core/types.js';
import { HttpError } from '../../core/http-error.js';
import { errorMessage } from '../../core/errors.js';
import { IncompleteSummaryError } from '../../core/context-errors.js';
import type { ModelSettingsStore } from '../model-selection/settings.js';
import { requireJsonMutation, sendJson, sendText } from '../http.js';
import { THEME_SYSTEM_PROMPT, themePrompt } from './prompt.js';
import { readThemeRequest, themeFromReply, type ThemeRequest } from './request.js';

export const THEME_GENERATE_PATH = '/api/themes/generate';

/*
 * Room for a full theme (about 2,000 tokens) plus the little reasoning a low
 * effort allows, within the 4,096-token output limit of the smallest models.
 */
const THEME_OUTPUT_TOKENS = 4_096;

/*
 * A theme is a small structured answer, so it runs at the least reasoning the
 * model supports. The chat's own effort could spend the whole output budget on
 * reasoning and leave no JSON, on providers that count reasoning as output.
 */
export function themeEffort(efforts: readonly ReasoningEffort[] | undefined): ReasoningEffort {
  return LOW_EFFORTS.find((effort) => efforts?.includes(effort)) ?? 'provider-default';
}

const LOW_EFFORTS: ReasoningEffort[] = ['none', 'minimal', 'low'];

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
      const entry = models.find((candidate) => candidate.key === chat.key);
      const spec = entry?.model ?? chat.key;
      const model = resolveModel(spec);
      const tracked = transformModel ? transformModel(model, chat.key, spec) : model;

      // requireComplete adds a 120-second limit and rejects a reply that stopped early.
      const text = await fromAiSdk(tracked, themeEffort(entry?.efforts), spec).generate({
        system: THEME_SYSTEM_PROMPT,
        prompt: themePrompt(request),
        maxOutputTokens: THEME_OUTPUT_TOKENS,
        requireComplete: true,
        ...(signal ? { abortSignal: signal } : {}),
      }).catch((error: unknown) => {
        throw themeFailure(error, signal);
      });

      return themeFromReply(text);
    },
  };
}

/** Plain messages for a model that stalled or stopped mid-theme; anything else passes through. */
function themeFailure(error: unknown, signal?: AbortSignal): unknown {
  if (signal?.aborted) return error;

  if (error instanceof IncompleteSummaryError) {
    return new HttpError(502, 'The chat model stopped before finishing the theme. Try again or ask for something simpler.');
  }

  if (error instanceof Error && error.name === 'TimeoutError') {
    return new HttpError(504, 'The chat model took too long to design the theme. Try again.');
  }

  return error;
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
