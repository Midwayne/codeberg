import { newCustomThemeId } from './custom-themes';
import { jsonInit, readJson } from './http';
import { normalizeTheme } from './theme-normalize';
import type { CustomTheme, CustomThemeId, Theme } from './theme-types';

export const THEME_GENERATE_PATH = '/api/themes/generate';

/** The longest description the server accepts (MAX_THEME_PROMPT); a test keeps them equal. */
export const THEME_PROMPT_LIMIT = 600;

export type ThemeRequest = {
  prompt: string;
  animated: boolean;
  /** The theme to change instead of designing from scratch. */
  base?: Theme;
  /** Replace this saved theme instead of adding a new one. */
  id?: CustomThemeId;
};

/** The parts of a theme the model can change, including a built-in scene name as its backdrop. */
export function themeForPrompt(theme: Theme) {
  return {
    label: theme.label,
    description: theme.description,
    colorScheme: theme.colorScheme,
    heading: theme.heading ?? 'sans',
    body: theme.body ?? 'sans',
    code: theme.code ?? 'mono',
    textScale: theme.textScale ?? 1,
    radius: Number.parseFloat(theme.radius ?? '0.625'),
    transition: theme.transition ?? 'reveal',
    palette: theme.palette,
    backdrop: theme.backdrop ?? null,
    parts: theme.parts ?? null,
  };
}

/** Asks the chat model for a theme and returns it validated, under the given or a new id. */
export async function generateTheme(
  fetcher: typeof fetch,
  request: ThemeRequest,
  signal?: AbortSignal,
): Promise<CustomTheme> {
  const body = {
    prompt: request.prompt,
    animated: request.animated,
    ...(request.base ? { base: themeForPrompt(request.base) } : {}),
  };

  const response = await fetcher(THEME_GENERATE_PATH, jsonInit('POST', body, signal ? { signal } : {}));
  const { theme } = await readJson<{ theme: unknown }>(response, 'Could not create a theme.');

  return normalizeTheme(theme, {
    id: request.id ?? newCustomThemeId(),
    prompt: originalPrompt(request),
    animated: request.animated,
    keep: request.base?.backdrop,
  });
}

/* An edit keeps the description the theme was created from; the change is not a new one. */
function originalPrompt(request: ThemeRequest): string {
  const base = request.base as Partial<CustomTheme> | undefined;

  return request.id && typeof base?.prompt === 'string' && base.prompt ? base.prompt : request.prompt;
}
