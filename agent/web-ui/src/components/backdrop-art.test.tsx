import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BackdropArtPieces, BackdropSprites } from './backdrop-art';
import type { BackdropArt, BackdropSprite } from '../lib/theme-types';

const still = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10"><circle r="4"/></svg>';
const moving = still.replace('<circle r="4"/>', '<circle r="4"><animate attributeName="r" values="4;5;4" dur="6s"/></circle>');

const art = (svg: string): BackdropArt => ({ svg, anchor: 'right', size: 30, opacity: 0.8, flip: false, animation: 'sway', duration: 12 });

describe('backdrop art', () => {
  it('shows art only as images, with a still copy for reduced motion when the drawing animates', () => {
    const plain = renderToStaticMarkup(<BackdropArtPieces art={[art(still)]} />);
    const animated = renderToStaticMarkup(<BackdropArtPieces art={[art(moving)]} />);

    expect(plain).not.toContain('<picture');
    expect(plain).not.toContain('<svg');
    expect(plain).toContain('src="data:image/svg+xml;charset=utf-8,');

    expect(animated).toContain('<source media="(prefers-reduced-motion: reduce)"');
    expect(decodeURIComponent(animated.match(/srcset="([^"]+)"/i)![1]!)).not.toContain('animate');
  });

  it('scatters each sprite layer into its count of copies at stable places', () => {
    const sprite: BackdropSprite = { svg: still, count: 5, size: 20, opacity: 0.7, animation: 'fall', duration: 20, spin: true };

    const first = renderToStaticMarkup(<BackdropSprites sprites={[sprite, { ...sprite, count: 3 }]} />);
    const again = renderToStaticMarkup(<BackdropSprites sprites={[sprite, { ...sprite, count: 3 }]} />);
    const lefts = [...first.matchAll(/left:([\d.]+)%/g)].map((match) => match[1]);

    expect(first.match(/class="backdrop-sprite"/g)).toHaveLength(8);
    expect(new Set(lefts).size).toBe(8);
    expect(again).toBe(first);
  });
});
