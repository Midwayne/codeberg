import { describe, expect, it } from 'vitest';

import { layerStyle } from './backdrop-layers';
import type { BackdropLayer } from './theme-types';

const base: BackdropLayer = {
  kind: 'stars', color: '#ffffff', opacity: 0.3, x: 50, y: 50, size: 40, angle: 0, animation: 'none', duration: 30,
};

describe('generated backdrop layers', () => {
  it('animates only layers that ask for it, with seamless loops for pans and spins', () => {
    expect(layerStyle(base).animation).toBeUndefined();

    expect(layerStyle({ ...base, animation: 'pulse' }).animation).toBe('backdrop-pulse 30s ease-in-out infinite alternate');
    expect(layerStyle({ ...base, animation: 'pan', duration: 60 }).animation).toBe('backdrop-pan 60s linear infinite normal');
  });

  it('tiles patterns at the pan distance so the scroll never jumps', () => {
    const style = layerStyle({ ...base, animation: 'pan' });

    expect(style.backgroundSize).toBe(`${style['--layer-pan']} ${style['--layer-pan']}`);
  });
});
