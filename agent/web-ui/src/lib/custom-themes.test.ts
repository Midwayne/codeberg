import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CUSTOM_THEMES_STORAGE_KEY,
  customThemes,
  MAX_CUSTOM_THEMES,
  removeCustomTheme,
  resetCustomThemeCache,
  saveCustomTheme,
  subscribeCustomThemes,
  subscribeOtherTabThemes,
  hasRoomForTheme,
  hasUnsavedThemes,
  ThemeLimitError,
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

  it('refuses a new theme past the limit instead of deleting one, still allows edits, and restores after reload', () => {
    for (let index = 0; index < MAX_CUSTOM_THEMES; index += 1) saveCustomTheme(theme(`custom-${index}`));

    expect(hasRoomForTheme()).toBe(false);
    expect(() => saveCustomTheme(theme('custom-extra'))).toThrow(ThemeLimitError);
    expect(() => saveCustomTheme({ ...theme('custom-0'), label: 'Edited' })).not.toThrow();

    resetCustomThemeCache();

    expect(customThemes()).toHaveLength(MAX_CUSTOM_THEMES);
    expect(customThemes().find((entry) => entry.id === 'custom-0')?.label).toBe('Edited');
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

  it('keeps a theme another tab saved when this tab saves its own', () => {
    saveCustomTheme(theme('custom-a'));

    const otherTab = JSON.parse(stored!) as unknown[];
    stored = JSON.stringify([{ ...(otherTab[0] as object), id: 'custom-b', label: 'From another tab' }, ...otherTab]);

    saveCustomTheme(theme('custom-c'));

    expect(customThemes().map((entry) => entry.id)).toEqual(['custom-c', 'custom-b', 'custom-a']);
  });

  it('keeps every theme saved on the page when browser storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('storage blocked'); },
      setItem: () => { throw new Error('storage blocked'); },
    });

    saveCustomTheme(theme('custom-a'));
    saveCustomTheme(theme('custom-b'));
    removeCustomTheme('custom-a');
    saveCustomTheme(theme('custom-c'));

    expect(customThemes().map((entry) => entry.id)).toEqual(['custom-c', 'custom-b']);
  });

  it('reports another tab’s change so the theme in use can be re-applied', () => {
    let onStorage: ((event: { key: string | null }) => void) | undefined;
    vi.stubGlobal('window', { addEventListener: (_type: string, handler: typeof onStorage) => { onStorage = handler; } });
    const reapply = vi.fn();
    subscribeOtherTabThemes(reapply);

    saveCustomTheme(theme('custom-a'));

    expect(reapply).not.toHaveBeenCalled();

    stored = '[]';
    onStorage?.({ key: CUSTOM_THEMES_STORAGE_KEY });

    expect(reapply).toHaveBeenCalledTimes(1);
    expect(customThemes()).toEqual([]);
  });

  it('keeps an edited theme in its place in the list', () => {
    saveCustomTheme(theme('custom-a'));
    saveCustomTheme(theme('custom-b'));
    saveCustomTheme({ ...theme('custom-a'), label: 'Edited' });

    expect(customThemes().map((entry) => entry.label)).toEqual(['custom-b', 'Edited']);
  });

  it('does not overwrite a saved list it cannot read', () => {
    saveCustomTheme(theme('custom-a'));
    stored = '[{"id":"custom-a",';

    saveCustomTheme(theme('custom-b'));

    expect(customThemes().map((entry) => entry.id)).toEqual(['custom-b', 'custom-a']);
  });

  it('keeps a theme the browser could not write, when storage still reads (a full quota)', () => {
    saveCustomTheme(theme('custom-a'));
    vi.stubGlobal('localStorage', {
      getItem: () => stored,
      setItem: () => { throw new Error('quota exceeded'); },
    });

    saveCustomTheme(theme('custom-b'));
    saveCustomTheme(theme('custom-c'));

    expect(customThemes().map((entry) => entry.id)).toEqual(['custom-c', 'custom-b', 'custom-a']);
  });

  it('writes back saved entries this version cannot use instead of deleting them', () => {
    const foreign = { id: 'other-format', palette: { background: '#000000' } };
    stored = JSON.stringify([foreign]);

    saveCustomTheme(theme('custom-a'));

    expect(JSON.parse(stored!)).toContainEqual(foreign);
    expect(customThemes().map((entry) => entry.id)).toEqual(['custom-a']);
  });

  it('keeps a theme the browser could not store when another tab writes', () => {
    let onStorage: ((event: { key: string | null }) => void) | undefined;
    vi.stubGlobal('window', { addEventListener: (_type: string, handler: typeof onStorage) => { onStorage = handler; } });
    subscribeCustomThemes(() => undefined);
    saveCustomTheme(theme('custom-old'));

    let full = true;
    vi.stubGlobal('localStorage', {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        if (full) throw new Error('quota exceeded');

        stored = value;
      },
    });

    saveCustomTheme(theme('custom-new'));

    expect(hasUnsavedThemes()).toBe(true);

    stored = '[]';
    onStorage?.({ key: CUSTOM_THEMES_STORAGE_KEY });

    expect(customThemes().map((entry) => entry.id)).toEqual(['custom-new']);

    full = false;
    saveCustomTheme(theme('custom-later'));

    expect(hasUnsavedThemes()).toBe(false);
    expect((JSON.parse(stored!) as { id: string }[]).map((entry) => entry.id)).toEqual(['custom-later', 'custom-new']);
  });

  it('copies an unreadable saved value aside before a save replaces it', () => {
    const backup = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === CUSTOM_THEMES_STORAGE_KEY ? stored : backup.get(key) ?? null),
      setItem: (key: string, value: string) => {
        if (key === CUSTOM_THEMES_STORAGE_KEY) stored = value;
        else backup.set(key, value);
      },
    });
    stored = '{"themes": "from another version"}';

    saveCustomTheme(theme('custom-a'));

    expect([...backup.values()]).toEqual(['{"themes": "from another version"}']);
  });

  it('drops entries it cannot show before giving up on storing the user’s own themes', () => {
    stored = JSON.stringify([{ id: 'other-format', note: 'x'.repeat(100) }]);
    vi.stubGlobal('localStorage', {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        if (value.includes('other-format')) throw new Error('quota exceeded');

        stored = value;
      },
    });

    saveCustomTheme(theme('custom-a'));

    expect(hasUnsavedThemes()).toBe(false);
    expect((JSON.parse(stored!) as { id: string }[]).map((entry) => entry.id)).toEqual(['custom-a']);
  });
});

