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
 * A theme is about 2,000 tokens. Models without reasoning get 4,096, within the
 * smallest output limits. Reasoning models (any that offer effort levels) also
 * think first, possibly by default when no low effort exists, and support far
 * larger outputs, so they get room for that thinking too.
 */
const THEME_OUTPUT_TOKENS = 4_096;
const REASONING_THEME_OUTPUT_TOKENS = 16_000;

export function themeOutputTokens(efforts: readonly ReasoningEffort[] | undefined): number {
  const reasons = efforts?.some((effort) => effort !== 'provider-default') ?? false;

  return reasons ? REASONING_THEME_OUTPUT_TOKENS : THEME_OUTPUT_TOKENS;
}

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

      const generator = fromAiSdk(tracked, themeEffort(entry?.efforts), spec);
      const ask = (maxOutputTokens: number) => generator.generate({
        system: THEME_SYSTEM_PROMPT,
        prompt: themePrompt(request),
        maxOutputTokens,
        // Adds a 120-second limit and rejects a reply that stopped early.
        requireComplete: true,
        ...(signal ? { abortSignal: signal } : {}),
      });

      const text = await withRoomToThink(ask, themeOutputTokens(entry?.efforts)).catch((error: unknown) => {
        throw themeFailure(error, signal);
      });

      return themeFromReply(text);
    },
  };
}

/*
 * A model that reasons without saying so (no effort levels listed, or not in
 * the catalog) can spend the small budget thinking and stop before the theme.
 * One retry with room to think recovers that, without sending a large limit to
 * small models up front, which some providers reject.
 */
async function withRoomToThink(ask: (tokens: number) => Promise<string>, budget: number): Promise<string> {
  try {
    return await ask(budget);
  } catch (error) {
    if (!(error instanceof IncompleteSummaryError) || budget >= REASONING_THEME_OUTPUT_TOKENS) throw error;

    // A small model may reject the larger limit; its first, clearer failure is the one to report.
    return ask(REASONING_THEME_OUTPUT_TOKENS).catch((retry: unknown) => {
      throw retry instanceof IncompleteSummaryError || isTimeout(retry) ? retry : error;
    });
  }
}

/** Plain messages for a model that stalled or stopped mid-theme; anything else passes through. */
function themeFailure(error: unknown, signal?: AbortSignal): unknown {
  if (signal?.aborted) return error;

  if (error instanceof IncompleteSummaryError) {
    // Raised for an empty reply and for one cut off early; both mean no usable theme.
    return new HttpError(502, 'The chat model did not finish a theme. Try again or reword the description.');
  }

  if (isTimeout(error)) {
    return new HttpError(504, 'The chat model took too long to design the theme. Try again.');
  }

  return error;
}

/* The SDK may pass the timeout through or wrap it (in a retry error, say). */
export function isTimeout(error: unknown): boolean {
  let current = error;

  for (let depth = 0; depth < 4; depth += 1) {
    if (!(current instanceof Error)) return false;

    if (current.name === 'TimeoutError') return true;

    current = current.cause;
  }

  return false;
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
