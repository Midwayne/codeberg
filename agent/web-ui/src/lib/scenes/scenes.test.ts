import { describe, expect, it } from 'vitest';

import { PAINTED_THEMES } from '../theme-palettes-painted';

/* A canvas context that accepts every call, so a scene's drawing code runs end to end. */
function stubContext(): unknown {
  const gradient = { addColorStop: () => undefined };

  return new Proxy({}, {
    get: (_, key) => (key === 'createLinearGradient' || key === 'createRadialGradient' ? () => gradient : () => undefined),
    set: () => true,
  });
}

class StubCanvas {
  constructor(public width: number, public height: number) {}

  getContext() {
    return stubContext();
  }
}

type Hooks = { setup?: (s: object) => void; frame?: (s: object) => void; event?: (name: string, s: object) => void };

/* Loads a scene as the worker does, then drives it: set up, draw, react, resize, draw again. */
function drive(script: string, motion: boolean) {
  let hooks: Hooks = {};
  new Function('scene', 'OffscreenCanvas', script)((value: Hooks) => (hooks = value), StubCanvas);

  const random = (seed: number) => {
    let x = seed || 1;
    return () => ((x = (x * 16807) % 2147483647) / 2147483647);
  };
  const s = { ctx: stubContext(), width: 1600, height: 900, dpr: 2, t: 0, dt: 0, colors: {}, motion, state: {}, random };

  hooks.setup?.(s);
  hooks.frame?.({ ...s, t: 1, dt: 0.016 });

  for (const name of ['send', 'reply', 'error', 'new-chat']) hooks.event?.(name, { ...s, t: 1.5 });

  Object.assign(s, { width: 390, height: 844, t: 2 });
  hooks.setup?.(s);
  hooks.frame?.({ ...s, t: 2.5 });

  return hooks;
}

describe('built-in theme scenes', () => {
  it.each(PAINTED_THEMES.map((theme) => [theme.label, theme.backdrop.scene.script] as const))(
    '%s sets up, draws, reacts to every app event, and redraws after a resize',
    (_, script) => {
      expect(Object.keys(drive(script, true))).toContain('frame');
      expect(() => drive(script, false)).not.toThrow();
    },
  );
});
