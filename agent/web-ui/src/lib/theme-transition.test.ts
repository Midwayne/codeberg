import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { changeTheme } from './theme-transition';

describe('theme transitions', () => {
  const root = {
    dataset: {} as Record<string, string>,
    classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() },
    style: { setProperty: vi.fn(), removeProperty: vi.fn(), colorScheme: '' },
  };
  let reduce = false;
  const timers = new Map<number, () => void>();
  let nextTimer = 0;

  beforeEach(() => {
    root.dataset = {};
    root.classList.add.mockClear();
    root.classList.remove.mockClear();
    timers.clear();
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
    vi.stubGlobal('window', {
      innerWidth: 1000,
      innerHeight: 800,
      matchMedia: () => ({ matches: reduce }),
      setTimeout: (callback: () => void) => {
        nextTimer += 1;
        timers.set(nextTimer, callback);

        return nextTimer;
      },
      clearTimeout: (id: number) => timers.delete(id),
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

  it('keeps the newer effect when a second change interrupts the first', async () => {
    const finishes: (() => void)[] = [];
    const startViewTransition = vi.fn((update: () => void) => {
      update();

      return { finished: new Promise<void>((resolve) => finishes.push(resolve)) };
    });
    vi.stubGlobal('document', { documentElement: root, startViewTransition });

    changeTheme('midnight');
    changeTheme('phosphor');

    finishes[0]!();
    await Promise.resolve();
    await Promise.resolve();

    expect(root.dataset.themeTransition).toBe('wipe');

    finishes[1]!();
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

  it('restarts the color fade on a quick second change instead of cutting it short', () => {
    vi.stubGlobal('document', { documentElement: root });

    changeTheme('ember');
    changeTheme('aurora');

    // Only the second fade's timer is left; the first was cleared, not left to cut it short.
    expect(timers.size).toBe(1);

    for (const finish of timers.values()) finish();

    expect(root.classList.remove).toHaveBeenCalledTimes(1);
    expect(root.classList.remove).toHaveBeenCalledWith('theme-fading');
  });
});

