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

  it('keeps Graphite as the default and rejects unknown stored themes', () => {
    expect(loadTheme()).toBe('graphite');
    saved = 'dark';
    expect(loadTheme()).toBe('graphite');
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
    applyTheme('porcelain');
    applyTheme(loadTheme());
    expect(root.dataset.theme).toBe('ember');
  });

  it('replaces every token when switching between a dark and a light theme', () => {
    applyTheme('midnight');
    const tokens = [...properties.keys()];
    properties.clear();
    applyTheme('porcelain');
    expect([...properties.keys()]).toEqual(tokens);
    expect(properties.get('--background')).toBe('#ffffff');
    expect(properties.get('--foreground')).toBe('#18181b');
    expect(properties.get('--accent-foreground')).toBe('#18181b');
    expect(root.style.colorScheme).toBe('light');
    expect(root.classList.toggle).toHaveBeenLastCalledWith('dark', false);
  });

  it('gives the clean themes separate supporting and floating surfaces', () => {
    applyTheme('graphite');

    expect(properties.get('--card')).toBe('#0b0b0c');
    expect(properties.get('--popover')).toBe('#1c1c1f');

    applyTheme('porcelain');

    expect(properties.get('--card')).toBe('#f7f7f8');
    expect(properties.get('--popover')).toBe('#ffffff');

    applyTheme('phosphor');

    expect(properties.get('--popover')).toBe(properties.get('--card'));
  });

  it('applies each theme’s typefaces and corner radius, resetting fonts it does not set', () => {
    applyTheme('phosphor');

    expect(properties.get('--font-body')).toBe(FONT_STACKS.mono);
    expect(properties.get('--font-heading')).toBe(FONT_STACKS.mono);
    expect(properties.get('--radius')).toBe('0.125rem');

    applyTheme('parchment');

    expect(properties.get('--font-body')).toBe(FONT_STACKS.sans);
    expect(properties.get('--font-heading')).toBe(FONT_STACKS.serif);

    applyTheme('graphite');

    expect(properties.get('--font-heading')).toBe(FONT_STACKS.sans);
    expect(properties.get('--radius')).toBe('0.75rem');
  });

  it('still applies selections when browser storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('storage blocked'); },
      setItem: () => { throw new Error('storage blocked'); },
    });
    expect(loadTheme()).toBe('graphite');
    expect(() => setTheme('aurora')).not.toThrow();
    expect(root.dataset.theme).toBe('aurora');
  });

  it('keeps destructive button labels readable on each theme’s error color', () => {
    applyTheme('ember');
    expect(properties.get('--destructive-foreground')).toBe('#000000');
    applyTheme('porcelain');
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
