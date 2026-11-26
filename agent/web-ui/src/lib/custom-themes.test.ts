import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CUSTOM_THEMES_STORAGE_KEY,
  customThemes,
  MAX_CUSTOM_THEMES,
  removeCustomTheme,
  resetCustomThemeCache,
  saveCustomTheme,
  subscribeCustomThemes,
} from './custom-themes';
import { normalizeTheme } from './theme-normalize';
import { findTheme } from './themes';
import type { CustomThemeId } from './theme-types';

function theme(id: CustomThemeId) {
  return normalizeTheme({ label: id, palette: { background: '#101010' } }, { id, prompt: 'test', animated: true });
}

describe('saved custom themes', () => {
  let stored: string | null;

  beforeEach(() => {
    stored = null;
    vi.stubGlobal('localStorage', {
      getItem: () => stored,
      setItem: (_key: string, value: string) => { stored = value; },
    });
    resetCustomThemeCache();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('saves newest first, notifies listeners, and makes the theme findable by id', () => {
    const listener = vi.fn();
    subscribeCustomThemes(listener);

    saveCustomTheme(theme('custom-a'));
    saveCustomTheme(theme('custom-b'));

    expect(customThemes().map((entry) => entry.id)).toEqual(['custom-b', 'custom-a']);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(findTheme('custom-a').label).toBe('custom-a');

    removeCustomTheme('custom-a');

    expect(findTheme('custom-a').id).toBe('graphite');
  });

  it('keeps the newest twelve and restores them after a reload', () => {
    for (let index = 0; index < MAX_CUSTOM_THEMES + 2; index += 1) saveCustomTheme(theme(`custom-${index}`));

    resetCustomThemeCache();

    expect(customThemes()).toHaveLength(MAX_CUSTOM_THEMES);
    expect(customThemes()[0]!.id).toBe(`custom-${MAX_CUSTOM_THEMES + 1}`);
  });

  it('skips stored entries that no longer validate', () => {
    stored = JSON.stringify([
      { id: 'not-custom', palette: { background: '#000000' } },
      { id: 'custom-broken', palette: {} },
      { id: 'custom-ok', label: 'Fine', palette: { background: '#000000' } },
    ]);

    expect(customThemes().map((entry) => entry.label)).toEqual(['Fine']);
    expect(localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY)).toBe(stored);
  });
});
