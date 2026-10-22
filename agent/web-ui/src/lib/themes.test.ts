import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyTheme, loadTheme, setTheme, THEMES, THEME_STORAGE_KEY } from './themes';

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
    saved = 'tokyo-night';
    expect(loadTheme()).toBe('tokyo-night');
    expect(localStorage.getItem).toHaveBeenCalledWith(THEME_STORAGE_KEY);
  });

  it('applies and persists a selection, then restores it on reload', () => {
    setTheme('kanagawa');
    expect(root.dataset.theme).toBe('kanagawa');
    expect(root.style.colorScheme).toBe('dark');
    expect(properties.get('--background')).toBe('#1f1f28');
    expect(localStorage.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'kanagawa');
    applyTheme('light');
    applyTheme(loadTheme());
    expect(root.dataset.theme).toBe('kanagawa');
  });

  it('replaces every token when switching between a named theme and light', () => {
    applyTheme('tokyo-night');
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

    applyTheme('kanagawa');

    expect(properties.get('--popover')).toBe(properties.get('--card'));
  });

  it('still applies selections when browser storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('storage blocked'); },
      setItem: () => { throw new Error('storage blocked'); },
    });
    expect(loadTheme()).toBe('dark');
    expect(() => setTheme('nord')).not.toThrow();
    expect(root.dataset.theme).toBe('nord');
  });

  it('keeps destructive button labels readable on each theme’s error color', () => {
    applyTheme('kanagawa');
    expect(properties.get('--destructive-foreground')).toBe('#000000');
    applyTheme('light');
    expect(properties.get('--destructive-foreground')).toBe('#ffffff');
  });

  it('applies every supported theme with complete UI tokens', () => {
    for (const theme of THEMES) {
      properties.clear();
      applyTheme(theme.id);
      expect(properties.size).toBe(19);
      expect([...properties.values()].every(Boolean)).toBe(true);
      expect(root.style.colorScheme).toBe(theme.colorScheme);
    }
  });
});
