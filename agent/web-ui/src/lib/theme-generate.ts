import { newCustomThemeId } from './custom-themes';
import { jsonInit, readJson } from './http';
import { normalizeTheme } from './theme-normalize';
import type { CustomTheme, Theme } from './theme-types';

export const THEME_GENERATE_PATH = '/api/themes/generate';

export type ThemeRequest = { prompt: string; animated: boolean; base?: Theme };

/** The parts of a theme the model can change; built-in scene names are left out. */
export function themeForPrompt(theme: Theme) {
  return {
    label: theme.label,
    description: theme.description,
    colorScheme: theme.colorScheme,
    heading: theme.heading ?? 'sans',
    body: theme.body ?? 'sans',
    radius: Number.parseFloat(theme.radius ?? '0.625'),
    transition: theme.transition ?? 'reveal',
    palette: theme.palette,
    backdrop: typeof theme.backdrop === 'object' ? theme.backdrop : null,
  };
}

/** Asks the chat model for a theme and returns it validated, under a new id. */
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

  return normalizeTheme(theme, { id: newCustomThemeId(), prompt: request.prompt, animated: request.animated });
}
