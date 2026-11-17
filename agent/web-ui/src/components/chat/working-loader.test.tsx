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
    ['cube', 'loader-face', 6],
    ['roll', 'loader-face', 6],
    ['bounce', 'loader-face', 6],
    ['bounce', 'loader-ball', 1],
    ['burst', 'loader-face', 48],
    ['twist', 'loader-plate', 3],
    ['stack', 'loader-plate', 3],
  ] as const)('renders the %s loader with %s parts', (variant, part, count) => {
    const html = renderToStaticMarkup(<WorkingLoader variant={variant} />);

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(`data-loader="${variant}"`);
    expect(html.match(new RegExp(`class="${part}"`, 'g'))).toHaveLength(count);
  });

  it('places the burst cubes at every corner', () => {
    const html = renderToStaticMarkup(<WorkingLoader variant="burst" />);
    const corners = html.match(/--x:-?1;--y:-?1;--z:-?1/g) ?? [];

    expect(new Set(corners).size).toBe(8);
  });
});
