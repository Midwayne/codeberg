import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { customThemes, removeCustomTheme, resetCustomThemeCache, saveCustomTheme } from './custom-themes';
import { commitTheme, restoreTheme } from './theme-commit';
import { normalizeTheme } from './theme-normalize';
import { activeThemeId, applyTheme } from './themes';

const theme = (label: string) =>
  normalizeTheme({ label, palette: { background: '#101010' } }, { id: 'custom-a', prompt: 'x', animated: true });

describe('committing a generated theme', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    vi.stubGlobal('document', {
      documentElement: { dataset: {}, classList: { toggle: vi.fn() }, style: { setProperty: vi.fn(), removeProperty: vi.fn() } },
    });
    resetCustomThemeCache();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('replaces the edited theme in place while it still exists', () => {
    saveCustomTheme(theme('Before'));

    expect(commitTheme(theme('After'), theme('Before'))).toBe(true);
    expect(customThemes().map((entry) => entry.label)).toEqual(['After']);
  });

  it('drops a change that arrives after its theme was deleted', () => {
    saveCustomTheme(theme('Before'));
    removeCustomTheme('custom-a');

    expect(commitTheme(theme('After'), theme('Before'))).toBe(false);
    expect(customThemes()).toEqual([]);
  });

  it('does not bring back a deleted theme on undo', () => {
    saveCustomTheme(theme('Before'));
    removeCustomTheme('custom-a');

    expect(restoreTheme(theme('Before'))).toBe(false);
    expect(customThemes()).toEqual([]);
  });

  it('restores the earlier version without switching back when another theme is in use', () => {
    saveCustomTheme(theme('After'));
    applyTheme('graphite');

    expect(restoreTheme(theme('Before'))).toBe(true);
    expect(customThemes()[0]!.label).toBe('Before');
    expect(activeThemeId()).toBe('graphite');
  });
});
