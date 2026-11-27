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

  it('scrolls falling particles a whole tile per loop and hides shooting stars until their streak', () => {
    const snow = layerStyle({ ...base, kind: 'flakes', animation: 'fall', duration: 12 });

    expect(snow.animation).toBe('backdrop-fall 12s linear infinite normal');
    expect(snow.backgroundSize).toBe(`${snow['--layer-pan']} ${snow['--layer-pan']}`);

    const meteor = layerStyle({ ...base, kind: 'meteor', x: 20, y: 5, angle: 30, animation: 'shoot', duration: 9 });

    expect(meteor).toMatchObject({ left: '20%', top: '5%', opacity: 0, '--layer-angle': '30deg', '--layer-opacity': '0.3' });
  });
});
