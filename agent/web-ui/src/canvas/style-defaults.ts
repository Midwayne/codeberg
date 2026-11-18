import type { AppState } from '@excalidraw/excalidraw/types';

const STYLE_DEFAULTS = { currentItemRoughness: 1, currentItemFontFamily: 5, currentItemRoundness: 'round' } as const;

/**
 * The scene's drawing style (set by the agent or the user's toolbar picks), so new shapes match it.
 * Untouched built-in defaults are omitted, so opening a canvas does not save a spurious change.
 */
export function styleDefaults(state: Partial<AppState>, saved: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(STYLE_DEFAULTS).flatMap(([key, fallback]) => {
    const value = state[key as keyof AppState];
    return key in saved || (value !== undefined && value !== fallback) ? [[key, value]] : [];
  }));
}
