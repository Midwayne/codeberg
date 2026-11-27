import { describe, expect, it } from 'vitest';

import { normalizeTheme } from './theme-normalize';
import type { CustomBackdrop } from './theme-types';

const palette = { background: '#1b1020', foreground: '#fbe9f0' };
const branch = "<svg viewBox='0 0 300 600'><path d='M300 0 C 200 200, 250 400, 120 600' stroke='#5a3b2e' stroke-width='6' fill='none'/><animateTransform attributeName='transform' type='rotate' values='0;2;0' dur='8s' repeatCount='indefinite'/></svg>";
const petal = "<svg viewBox='0 0 10 10'><ellipse cx='5' cy='5' rx='5' ry='3' fill='#ffc0d0'/></svg>";

function backdropOf(backdrop: unknown, animated = true): CustomBackdrop | undefined {
  const theme = normalizeTheme({ palette, backdrop }, { id: 'custom-art', prompt: 'koganei blossom', animated });

  return typeof theme.backdrop === 'object' ? theme.backdrop : undefined;
}

describe('generated art and particles', () => {
  it('keeps a backdrop that is only art, with values clamped and bad drawings dropped', () => {
    const backdrop = backdropOf({
      art: [
        { svg: branch, anchor: 'top-right', size: 90, opacity: 2, flip: 'yes', animation: 'sway', duration: 1 },
        { svg: '<svg><circle r="3"/></svg>', anchor: 'left' },
        { svg: petal, anchor: 'middle' },
      ],
    });

    expect(backdrop?.layers).toEqual([]);
    expect(backdrop?.art).toHaveLength(2);
    expect(backdrop?.art?.[0]).toMatchObject({ anchor: 'top-right', size: 60, opacity: 1, flip: false, animation: 'sway', duration: 4 });
    expect(backdrop?.art?.[0]?.svg).toContain('<animateTransform');
    expect(backdrop?.art?.[1]?.anchor).toBe('right');
  });

  it('caps particle copies across sprite layers so the scene stays light to animate', () => {
    const backdrop = backdropOf({
      sprites: [
        { svg: petal, count: 24 },
        { svg: petal, count: 24 },
        { svg: petal, count: 24 },
      ],
    });

    expect(backdrop?.sprites?.map((sprite) => sprite.count)).toEqual([24, 24]);
  });

  it('stills art, particles, and the drawings themselves when Animated is off', () => {
    const backdrop = backdropOf({
      art: [{ svg: branch, animation: 'sway' }],
      sprites: [{ svg: petal, animation: 'fall' }],
    }, false);

    expect(backdrop?.art?.[0]?.animation).toBe('none');
    expect(backdrop?.art?.[0]?.svg).not.toContain('animate');
    expect(backdrop?.sprites?.[0]?.animation).toBe('none');
  });
});
