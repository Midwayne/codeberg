import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { customThemes, removeCustomTheme, resetCustomThemeCache, saveCustomTheme } from './custom-themes';
import { commitTheme, restoreTheme, ThemeConflictError } from './theme-commit';
import { normalizeTheme } from './theme-normalize';
import { activeThemeId, applyTheme } from './themes';

const theme = (label: string) =>
  normalizeTheme({ label, palette: { background: '#101010' } }, { id: 'custom-a', prompt: 'x', animated: true });

describe('committing a generated theme', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    vi.stubGlobal('document', {
      documentElement: { dataset: {}, classList: { toggle: vi.fn() }, style: { setProperty: vi.fn(), removeProperty: vi.fn() } },
    });
    resetCustomThemeCache();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('replaces the edited theme in place while it still exists', () => {
    saveCustomTheme(theme('Before'));

    expect(commitTheme(theme('After'), { editing: theme('Before') })).toBe(true);
    expect(customThemes().map((entry) => entry.label)).toEqual(['After']);
  });

  it('drops a change that arrives after its theme was deleted', () => {
    saveCustomTheme(theme('Before'));
    removeCustomTheme('custom-a');

    expect(commitTheme(theme('After'), { editing: theme('Before') })).toBe(false);
    expect(customThemes()).toEqual([]);
  });

  it('does not bring back a deleted theme on undo', () => {
    saveCustomTheme(theme('Before'));
    removeCustomTheme('custom-a');

    expect(restoreTheme(theme('Before'), theme('After'))).toBe(false);
    expect(customThemes()).toEqual([]);
  });

  it('restores the earlier version without switching back when another theme is in use', () => {
    saveCustomTheme(theme('After'));
    applyTheme('graphite');

    expect(restoreTheme(theme('Before'), theme('After'))).toBe(true);
    expect(customThemes()[0]!.label).toBe('Before');
    expect(activeThemeId()).toBe('graphite');
  });

  it('saves a late result without switching away from a theme picked meanwhile', () => {
    applyTheme('graphite');
    saveCustomTheme(theme('Before'));

    expect(commitTheme(theme('After'), { editing: theme('Before') })).toBe(true);
    expect(customThemes()[0]!.label).toBe('After');
    expect(activeThemeId()).toBe('graphite');

    expect(commitTheme({ ...theme('New'), id: 'custom-new' }, { activeAtStart: 'porcelain' })).toBe(true);
    expect(activeThemeId()).toBe('graphite');
  });

  it('refuses an edit or undo built on a version another tab has changed since', () => {
    saveCustomTheme(theme('Forest'));
    saveCustomTheme(theme('Serif forest'));

    expect(() => commitTheme(theme('Warm forest'), { editing: theme('Forest') })).toThrow(ThemeConflictError);
    expect(restoreTheme(theme('Forest'), theme('Warm forest'))).toBe(false);
    expect(customThemes()[0]!.label).toBe('Serif forest');
  });
});

