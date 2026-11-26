import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { changeTheme } from './theme-transition';

describe('theme transitions', () => {
  const root = {
    dataset: {} as Record<string, string>,
    classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() },
    style: { setProperty: vi.fn(), removeProperty: vi.fn(), colorScheme: '' },
  };
  let reduce = false;

  beforeEach(() => {
    root.dataset = {};
    root.classList.add.mockClear();
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
    vi.stubGlobal('window', {
      innerWidth: 1000,
      innerHeight: 800,
      matchMedia: () => ({ matches: reduce }),
      setTimeout: () => 0,
    });
  });
  afterEach(() => {
    reduce = false;
    vi.unstubAllGlobals();
  });

  it('runs the theme’s own effect as a view transition and clears it when done', async () => {
    let finish!: () => void;
    const startViewTransition = vi.fn((update: () => void) => {
      update();

      return { finished: new Promise<void>((resolve) => { finish = resolve; }) };
    });
    vi.stubGlobal('document', { documentElement: root, startViewTransition });

    changeTheme('phosphor');

    expect(root.dataset.themeTransition).toBe('wipe');
    expect(root.dataset.theme).toBe('phosphor');

    finish();
    await Promise.resolve();
    await Promise.resolve();

    expect(root.dataset.themeTransition).toBeUndefined();
  });

  it('fades colors without view transitions and switches instantly under reduced motion', () => {
    vi.stubGlobal('document', { documentElement: root });

    changeTheme('ember');

    expect(root.classList.add).toHaveBeenCalledWith('theme-fading');

    reduce = true;
    root.classList.add.mockClear();
    changeTheme('midnight');

    expect(root.classList.add).not.toHaveBeenCalled();
    expect(root.dataset.theme).toBe('midnight');
  });
});
