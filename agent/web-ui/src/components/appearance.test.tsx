import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BackdropToggle, ThemePicker } from './appearance';
import { normalizeTheme } from '../lib/theme-normalize';

describe('theme picker', () => {
  it('offers standard themes as a labeled native radio group with one selected theme', () => {
    const html = renderToStaticMarkup(<ThemePicker value="ember" onChange={() => undefined} />);
    expect(html).toContain('<fieldset');
    expect(html).toContain('<legend');
    for (const name of ['Graphite', 'Porcelain', 'Midnight', 'Aurora', 'Snowfall', 'Fireflies', 'Rainfall', 'Lanterns', 'Parchment', 'Ember', 'Phosphor']) {
      expect(html).toContain(`aria-label="${name}"`);
    }
    expect(html.match(/type="radio"/g)).toHaveLength(11);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toMatch(/aria-label="Ember"[^>]*checked=""/);
  });

  it('previews each built-in theme’s scene', () => {
    const html = renderToStaticMarkup(<ThemePicker value="graphite" onChange={() => undefined} />);

    expect(html.match(/class="backdrop-preview"/g)).toHaveLength(11);
    expect(html).toContain('data-scene="halo"');
    expect(html).toContain('data-kind="meteor"');
  });

  it('shows the backdrop switch on by default', () => {
    const html = renderToStaticMarkup(<BackdropToggle />);

    expect(html).toMatch(/type="checkbox"[^>]*checked=""/);
  });

  it('offers edit and delete only on saved themes', () => {
    const saved = normalizeTheme({ label: 'Mine', palette: { background: '#101010' } }, { id: 'custom-mine', prompt: 'x', animated: true });
    const html = renderToStaticMarkup(
      <ThemePicker value="graphite" onChange={() => undefined} custom={[saved]} onEdit={() => undefined} onDelete={() => undefined} />,
    );

    expect(html).toContain('Your themes');
    expect(html.match(/aria-label="Edit [^"]+"/g)).toEqual(['aria-label="Edit Mine"']);
    expect(html.match(/aria-label="Delete [^"]+"/g)).toEqual(['aria-label="Delete Mine"']);
    expect(html.match(/type="radio"/g)).toHaveLength(12);
  });
});
