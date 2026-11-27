import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyBackdrop, BACKDROP_STORAGE_KEY, loadBackdropEnabled, resetBackdropChoice, saveBackdropEnabled } from './backdrop';
import { applyTheme } from './themes';

describe('theme backdrops', () => {
  const root = {
    dataset: {} as Record<string, string>,
    classList: { toggle: vi.fn() },
    style: { setProperty: vi.fn(), removeProperty: vi.fn(), colorScheme: '' },
  };
  let saved: string | null;

  beforeEach(() => {
    saved = null;
    root.dataset = {};
    resetBackdropChoice();
    vi.stubGlobal('document', { documentElement: root });
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => saved),
      setItem: vi.fn((_key: string, value: string) => { saved = value; }),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('names the theme’s scene on the root and clears it when there is none', () => {
    applyTheme('midnight');

    expect(root.dataset.backdrop).toBe('custom');

    applyBackdrop(undefined);

    expect(root.dataset.backdrop).toBeUndefined();
  });

  it('keeps backdrops off after the browser turns them off', () => {
    expect(loadBackdropEnabled()).toBe(true);

    saveBackdropEnabled(false);

    expect(localStorage.setItem).toHaveBeenCalledWith(BACKDROP_STORAGE_KEY, 'off');
    expect(loadBackdropEnabled()).toBe(false);

    applyTheme('aurora');

    expect(root.dataset.backdrop).toBeUndefined();

    applyBackdrop('halo', true);

    expect(root.dataset.backdrop).toBe('halo');
  });

  it('shows backdrops when browser storage is blocked, and keeps turning them off for the page', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('storage blocked'); },
      setItem: () => { throw new Error('storage blocked'); },
    });

    expect(loadBackdropEnabled()).toBe(true);

    applyTheme('midnight');

    expect(root.dataset.backdrop).toBe('custom');
    expect(() => saveBackdropEnabled(false)).not.toThrow();

    applyTheme('aurora');

    expect(root.dataset.backdrop).toBeUndefined();
  });
});
