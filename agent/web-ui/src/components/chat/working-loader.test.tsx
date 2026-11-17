import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { loaderForTurn, loaderVariants, WorkingLoader } from './working-loader';

describe('working loader', () => {
  it('starts with the cube and cycles through every variant on later turns', () => {
    expect(loaderForTurn(0)).toBe('cube');
    expect(loaderForTurn(1)).toBe('cube');

    const turns = loaderVariants.map((_, index) => loaderForTurn(index + 1));

    expect(turns).toEqual([...loaderVariants]);
    expect(loaderForTurn(loaderVariants.length + 1)).toBe('cube');
  });

  it.each([
    ['cube', 'loader-cube-face', 6],
    ['tiles', 'loader-tile', 4],
    ['stack', 'loader-plate', 3],
    ['split', 'loader-quarter', 4],
  ] as const)('renders the %s loader as decorative parts', (variant, part, count) => {
    const html = renderToStaticMarkup(<WorkingLoader variant={variant} />);

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(`data-loader="${variant}"`);
    expect(html.match(new RegExp(`class="${part}"`, 'g'))).toHaveLength(count);
  });

  it('staggers the tiles clockwise', () => {
    const html = renderToStaticMarkup(<WorkingLoader variant="tiles" />);

    expect(html.match(/--i:(\d)/g)).toEqual(['--i:0', '--i:1', '--i:3', '--i:2']);
  });
});
