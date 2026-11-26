import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyTheme, FONT_STACKS, loadTheme, setTheme, THEMES, THEME_STORAGE_KEY } from './themes';

describe('themes', () => {
  const properties = new Map<string, string>();
  const root = {
    dataset: {} as Record<string, string>,
    classList: { toggle: vi.fn() },
    style: { setProperty: (name: string, value: string) => properties.set(name, value), colorScheme: '' },
  };
  let saved: string | null;

  beforeEach(() => {
    properties.clear();
    saved = null;
    root.dataset = {};
    root.classList.toggle.mockClear();
    vi.stubGlobal('document', { documentElement: root });
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => saved),
      setItem: vi.fn((_key: string, value: string) => { saved = value; }),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps dark as the default and rejects unknown stored themes', () => {
    expect(loadTheme()).toBe('dark');
    saved = 'removed-theme';
    expect(loadTheme()).toBe('dark');
    saved = 'midnight';
    expect(loadTheme()).toBe('midnight');
    expect(localStorage.getItem).toHaveBeenCalledWith(THEME_STORAGE_KEY);
  });

  it('applies and persists a selection, then restores it on reload', () => {
    setTheme('ember');
    expect(root.dataset.theme).toBe('ember');
    expect(root.style.colorScheme).toBe('dark');
    expect(properties.get('--background')).toBe('#262624');
    expect(localStorage.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'ember');
    applyTheme('light');
    applyTheme(loadTheme());
    expect(root.dataset.theme).toBe('ember');
  });

  it('replaces every token when switching between a named theme and light', () => {
    applyTheme('midnight');
    const tokens = [...properties.keys()];
    properties.clear();
    applyTheme('light');
    expect([...properties.keys()]).toEqual(tokens);
    expect(properties.get('--background')).toBe('#f5f5f5');
    expect(properties.get('--foreground')).toBe('#282828');
    expect(properties.get('--accent-foreground')).toBe('#282828');
    expect(root.style.colorScheme).toBe('light');
    expect(root.classList.toggle).toHaveBeenLastCalledWith('dark', false);
  });

  it('uses soft Codex neutrals with separate supporting and floating surfaces', () => {
    applyTheme('dark');

    expect(properties.get('--background')).toBe('#212121');
    expect(properties.get('--foreground')).toBe('#dcdcdc');
    expect(properties.get('--card')).toBe('#181818');
    expect(properties.get('--popover')).toBe('#303030');

    applyTheme('light');

    expect(properties.get('--card')).toBe('#ededed');
    expect(properties.get('--popover')).toBe('#ffffff');

    applyTheme('phosphor');

    expect(properties.get('--popover')).toBe(properties.get('--card'));
  });

  it('applies each theme’s typefaces and corner radius, resetting them for plain themes', () => {
    applyTheme('phosphor');

    expect(properties.get('--font-body')).toBe(FONT_STACKS.mono);
    expect(properties.get('--font-heading')).toBe(FONT_STACKS.mono);
    expect(properties.get('--radius')).toBe('0.125rem');

    applyTheme('parchment');

    expect(properties.get('--font-body')).toBe(FONT_STACKS.sans);
    expect(properties.get('--font-heading')).toBe(FONT_STACKS.serif);

    applyTheme('dark');

    expect(properties.get('--font-heading')).toBe(FONT_STACKS.sans);
    expect(properties.get('--radius')).toBe('0.625rem');
  });

  it('still applies selections when browser storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('storage blocked'); },
      setItem: () => { throw new Error('storage blocked'); },
    });
    expect(loadTheme()).toBe('dark');
    expect(() => setTheme('aurora')).not.toThrow();
    expect(root.dataset.theme).toBe('aurora');
  });

  it('keeps destructive button labels readable on each theme’s error color', () => {
    applyTheme('ember');
    expect(properties.get('--destructive-foreground')).toBe('#000000');
    applyTheme('light');
    expect(properties.get('--destructive-foreground')).toBe('#ffffff');
  });

  it('applies every supported theme with complete UI tokens', () => {
    for (const theme of THEMES) {
      properties.clear();
      applyTheme(theme.id);
      expect(properties.size).toBe(22);
      expect([...properties.values()].every(Boolean)).toBe(true);
      expect(root.style.colorScheme).toBe(theme.colorScheme);
    }
  });
});
